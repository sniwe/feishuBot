const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TK_ORDERS_ENDPOINT =
  process.env.OMS_TK_ORDERS_ENDPOINT ||
  'https://trendyadventurer.wixstudio.io/tb-redo/_functions/getAllOrdersLastNDays';
const TK_ORDERS_DAYS = Number(process.env.OMS_TK_ORDERS_DAYS || 1);
const RAW_SHOP_ROOM_CODES = String(process.env.OMS_TK_SHOP_ROOM_CODES || 'LG401,LG402,LG402');
const OUTPUT_DIR =
  process.env.OMS_CACHE_DIR || 'C:\\zhaoYing_english\\mgmt\\stealth_launcher\\oms\\data\\oms_cache';

function normalizeShopRoomCodes(input) {
  return String(input || '')
    .split(',')
    .map((x) => String(x || '').trim().toUpperCase())
    .filter(Boolean);
}

async function fetchOrdersLastNDays({ endpointUrl, shopRoomCode, days }) {
  const url = new URL(endpointUrl);
  url.searchParams.set('shopRoomCode', String(shopRoomCode));
  if (Number.isFinite(Number(days))) {
    url.searchParams.set('days', String(days));
  }

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }
    throw new Error(
      `Order fetch failed (${response.status}) ${response.statusText || ''} ${detail}`.trim()
    );
  }

  const payload = await response.json();
  if (Array.isArray(payload)) {
    return { orders: payload, raw: payload, finalUrl: url.toString() };
  }
  if (payload && Array.isArray(payload.orders)) {
    return { orders: payload.orders, raw: payload, finalUrl: url.toString() };
  }
  if (payload && Array.isArray(payload.data)) {
    return { orders: payload.data, raw: payload, finalUrl: url.toString() };
  }
  return { orders: [], raw: payload, finalUrl: url.toString() };
}

function deriveOrderId(order) {
  if (!order || typeof order !== 'object') return '';
  const keys = [
    'orderId',
    'platformOrderNo',
    'platform_order_no',
    'orderNo',
    'order_no',
    'id'
  ];
  for (const key of keys) {
    const value = order[key];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function toRowHash(value) {
  return crypto.createHash('md5').update(JSON.stringify(value || {}), 'utf8').digest('hex');
}

function toCacheRow({ order, shopRoomCode, fetchedAt, endpointUrl }) {
  const source = order && typeof order === 'object' ? order : { value: order };
  const derivedOrderId = deriveOrderId(source);
  const fallbackHash = toRowHash(source);
  const orderKey = `${shopRoomCode}::${derivedOrderId || fallbackHash}`;

  return {
    ...source,
    shopRoomCode,
    _fetched_at: fetchedAt,
    _source_endpoint: endpointUrl,
    __order_cache_key: orderKey
  };
}

function appendRowsToParquetWithPython({ inputJsonPath, outputParquetPath }) {
  const tempScriptPath = path.join(path.dirname(outputParquetPath), `tmp_append_${Date.now()}.py`);
  const pyCode = `
import json
from pathlib import Path
import pandas as pd

src = Path(r"""${inputJsonPath}""")
out = Path(r"""${outputParquetPath}""")
new_rows = json.loads(src.read_text(encoding="utf-8"))
new_df = pd.DataFrame(new_rows)

if out.exists():
    old_df = pd.read_parquet(out, engine="pyarrow")
    merged = pd.concat([old_df, new_df], ignore_index=True, sort=False)
else:
    merged = new_df.copy()

out.parent.mkdir(parents=True, exist_ok=True)
merged.to_parquet(out, index=False, engine="pyarrow")
print(str(out))
print(f"rows={len(merged)} cols={len(merged.columns)}")
`.trim();

  fs.writeFileSync(tempScriptPath, pyCode, 'utf8');
  const result = spawnSync('python', [tempScriptPath], { encoding: 'utf8' });
  try {
    fs.unlinkSync(tempScriptPath);
  } catch {
    // Ignore temp cleanup failures.
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`Meta parquet append failed via python. stdout=${stdout} stderr=${stderr}`);
  }
  return (result.stdout || '').trim();
}

function updateIncrementalParquetWithPythonV2({
  inputJsonPath,
  outputParquetPath,
  captureTimestamp,
  keyCandidates = ['__order_cache_key', 'orderId', 'platformOrderNo', 'orderNo', 'id']
}) {
  const tempScriptPath = path.join(path.dirname(outputParquetPath), `tmp_upsert_v2_${Date.now()}.py`);
  const pyCode = `
import hashlib
import json
from pathlib import Path
import pandas as pd

src = Path(r"""${inputJsonPath}""")
out = Path(r"""${outputParquetPath}""")
capture_ts = r"""${captureTimestamp}"""
key_candidates = ${JSON.stringify(keyCandidates)}

rows = json.loads(src.read_text(encoding="utf-8"))
new_df = pd.DataFrame(rows)
new_df["_captured_at"] = capture_ts

if out.exists():
    old_df = pd.read_parquet(out, engine="pyarrow")
else:
    old_df = pd.DataFrame()

cache_rows_before = int(len(old_df))

def _normalize_key_series(series):
    return (
        series.astype(str)
        .str.replace(r"\\s+", " ", regex=True)
        .str.strip()
        .replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    )

def _row_hash(d):
    payload = {k: v for k, v in d.items() if k != "_captured_at"}
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.md5(text.encode("utf-8")).hexdigest()

pk = next((k for k in key_candidates if k in new_df.columns or k in old_df.columns), None)
delta_inserted = 0
delta_updated = 0
delta_unchanged = 0
delta_preserved = 0

if pk:
    if pk in new_df.columns:
        new_df[pk] = _normalize_key_series(new_df[pk])
        new_df = new_df.dropna(subset=[pk]).drop_duplicates(subset=[pk], keep="last")
    if not old_df.empty and pk in old_df.columns:
        old_df[pk] = _normalize_key_series(old_df[pk])

    old_lookup = {}
    if not old_df.empty and pk in old_df.columns:
        for _, row in old_df.dropna(subset=[pk]).drop_duplicates(subset=[pk], keep="last").iterrows():
            old_lookup[str(row[pk])] = row.to_dict()

    new_lookup = {}
    if pk in new_df.columns:
        for _, row in new_df.dropna(subset=[pk]).drop_duplicates(subset=[pk], keep="last").iterrows():
            new_lookup[str(row[pk])] = row.to_dict()

    old_keys = set(old_lookup.keys())
    new_keys = set(new_lookup.keys())
    shared_keys = old_keys.intersection(new_keys)
    delta_inserted = len(new_keys - old_keys)
    delta_preserved = len(old_keys - new_keys)

    for k in shared_keys:
        if _row_hash(old_lookup[k]) == _row_hash(new_lookup[k]):
            delta_unchanged += 1
        else:
            delta_updated += 1

    if old_df.empty:
        merged = new_df.copy()
    else:
        if pk in old_df.columns and pk in new_df.columns and not new_df.empty:
            old_kept = old_df[~old_df[pk].isin(set(new_df[pk].dropna().tolist()))]
        else:
            old_kept = old_df
        merged = pd.concat([old_kept, new_df], ignore_index=True, sort=False)
else:
    def _mk_row_key(row):
        text = json.dumps(row.to_dict(), ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.md5(text.encode("utf-8")).hexdigest()

    new_df["_row_key"] = new_df.apply(_mk_row_key, axis=1)
    if old_df.empty:
        merged = new_df.copy()
    else:
        if "_row_key" not in old_df.columns:
            old_df["_row_key"] = old_df.apply(_mk_row_key, axis=1)
        old_keys = set(old_df["_row_key"].tolist())
        new_keys = set(new_df["_row_key"].tolist())
        delta_inserted = len(new_keys - old_keys)
        delta_preserved = len(old_keys - new_keys)
        delta_unchanged = len(new_keys.intersection(old_keys))
        old_kept = old_df[~old_df["_row_key"].isin(new_keys)]
        merged = pd.concat([old_kept, new_df], ignore_index=True, sort=False)

if "_captured_at" in merged.columns:
    merged = merged.sort_values(by=["_captured_at"], kind="stable")

out.parent.mkdir(parents=True, exist_ok=True)
merged.to_parquet(out, index=False, engine="pyarrow")

result = {
    "path": str(out),
    "pk": pk,
    "cache_rows_before": cache_rows_before,
    "cache_rows_after": int(len(merged)),
    "extracted_rows": int(len(new_df)),
    "delta_inserted": int(delta_inserted),
    "delta_updated": int(delta_updated),
    "delta_unchanged": int(delta_unchanged),
    "delta_preserved": int(delta_preserved),
    "cols_after": int(len(merged.columns)),
}
print(json.dumps(result, ensure_ascii=False))
`.trim();

  fs.writeFileSync(tempScriptPath, pyCode, 'utf8');
  const result = spawnSync('python', [tempScriptPath], { encoding: 'utf8' });
  try {
    fs.unlinkSync(tempScriptPath);
  } catch {
    // Ignore temp cleanup failures.
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`Parquet write v2 failed via python. stdout=${stdout} stderr=${stderr}`);
  }
  const stdout = (result.stdout || '').trim();
  const lastLine = stdout.split(/\r?\n/).filter(Boolean).pop() || '{}';
  return JSON.parse(lastLine);
}

async function main() {
  const shopRoomCodes = normalizeShopRoomCodes(RAW_SHOP_ROOM_CODES);
  if (!shopRoomCodes.length) {
    throw new Error('No shopRoomCodes configured. Set OMS_TK_SHOP_ROOM_CODES.');
  }

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });

  const capturedAt = new Date().toISOString();
  const perStoreStats = [];
  const cacheRows = [];

  for (const shopRoomCode of shopRoomCodes) {
    const fetchResult = await fetchOrdersLastNDays({
      endpointUrl: TK_ORDERS_ENDPOINT,
      shopRoomCode,
      days: TK_ORDERS_DAYS
    });
    const orders = Array.isArray(fetchResult.orders) ? fetchResult.orders : [];
    for (const order of orders) {
      cacheRows.push(
        toCacheRow({
          order,
          shopRoomCode,
          fetchedAt: capturedAt,
          endpointUrl: fetchResult.finalUrl
        })
      );
    }

    perStoreStats.push({
      shopRoomCode,
      days: TK_ORDERS_DAYS,
      fetchedRows: orders.length,
      endpoint: fetchResult.finalUrl
    });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rowsTmpJsonPath = path.join(OUTPUT_DIR, `tk_orders_cache_${ts}.rows.tmp.json`);
  const metaTmpJsonPath = path.join(OUTPUT_DIR, `tk_orders_cache_${ts}.meta.tmp.json`);
  const latestParquetPath = path.join(OUTPUT_DIR, 'tk_orders_cache.parquet');
  const metaParquetPath = path.join(OUTPUT_DIR, 'tk_orders_cache_meta.parquet');

  await fsp.writeFile(rowsTmpJsonPath, JSON.stringify(cacheRows), 'utf8');
  const parquetUpdateResult = updateIncrementalParquetWithPythonV2({
    inputJsonPath: rowsTmpJsonPath,
    outputParquetPath: latestParquetPath,
    captureTimestamp: capturedAt,
    keyCandidates: ['__order_cache_key', 'orderId', 'platformOrderNo', 'orderNo', 'id']
  });

  const metaRecord = {
    capturedAt,
    source: 'wix.getAllOrdersLastNDays',
    endpoint: TK_ORDERS_ENDPOINT,
    days: Number(TK_ORDERS_DAYS),
    requestedShopRoomCodes: shopRoomCodes.join(','),
    requestedShopRoomCount: shopRoomCodes.length,
    fetchedRowsTotal: Number(cacheRows.length),
    perStoreStatsJson: JSON.stringify(perStoreStats),
    cacheRowsBefore: Number(parquetUpdateResult.cache_rows_before || 0),
    cacheRowsAfter: Number(parquetUpdateResult.cache_rows_after || 0),
    deltaInserted: Number(parquetUpdateResult.delta_inserted || 0),
    deltaUpdated: Number(parquetUpdateResult.delta_updated || 0),
    deltaUnchanged: Number(parquetUpdateResult.delta_unchanged || 0),
    deltaPreserved: Number(parquetUpdateResult.delta_preserved || 0),
    dedupeKey: String(parquetUpdateResult.pk || '')
  };
  await fsp.writeFile(metaTmpJsonPath, JSON.stringify([metaRecord]), 'utf8');

  const metaParquetUpdateResult = appendRowsToParquetWithPython({
    inputJsonPath: metaTmpJsonPath,
    outputParquetPath: metaParquetPath
  });

  await fsp.unlink(rowsTmpJsonPath).catch(() => {});
  await fsp.unlink(metaTmpJsonPath).catch(() => {});

  console.log(`TK endpoint: ${TK_ORDERS_ENDPOINT}`);
  console.log(`ShopRoomCodes: ${shopRoomCodes.join(',')}`);
  console.log(`Days: ${TK_ORDERS_DAYS}`);
  console.log(`Fetched rows this tick: ${cacheRows.length}`);
  console.log(`Incremental parquet: ${latestParquetPath}`);
  console.log(`Parquet update: ${JSON.stringify(parquetUpdateResult)}`);
  console.log(`Meta parquet: ${metaParquetPath}`);
  console.log(`Meta parquet update: ${metaParquetUpdateResult}`);
}

main().catch((error) => {
  console.error(`refresh_and_cache_tk_orders_parquet failed: ${error.message || error}`);
  process.exit(1);
});
