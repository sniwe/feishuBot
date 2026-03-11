const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

const PORT_START = Number(process.env.CDP_PORT_START || 9222);
const PORT_END = Number(process.env.CDP_PORT_END || 9260);
const PREFERRED_PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : null;
const TARGET_URL_FRAGMENT = process.env.OMS_TARGET_URL_FRAGMENT || 'oms.xlwms.com/platform/order/list';
const OMS_BASE_FRAGMENT = process.env.OMS_BASE_FRAGMENT || 'oms.xlwms.com';
const OMS_ORDERS_URL = process.env.OMS_ORDERS_URL || 'https://oms.xlwms.com/platform/order/list';
const OUTPUT_DIR = process.env.OMS_CACHE_DIR || 'C:\\zhaoYing_english\\mgmt\\stealth_launcher\\oms\\data\\oms_cache';
const TARGET_PAGE_SIZE = Number(process.env.OMS_TARGET_PAGE_SIZE || 2000);
const ENSURE_PAGE_SIZE_EACH_TICK = /^(1|true|yes|on)$/i.test(
  String(process.env.OMS_ENSURE_PAGE_SIZE_EACH_TICK || '0').trim()
);
const CDP_CONNECT_TIMEOUT_MS = Number(process.env.OMS_CDP_CONNECT_TIMEOUT_MS || 120_000);
const CDP_SELECT_RETRIES = Number(process.env.OMS_CDP_SELECT_RETRIES || 4);
const CDP_SELECT_RETRY_DELAY_MS = Number(process.env.OMS_CDP_SELECT_RETRY_DELAY_MS || 2_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findWorkingBrowserURL() {
  const ports = [];
  if (Number.isInteger(PREFERRED_PORT) && PREFERRED_PORT > 0) {
    ports.push(PREFERRED_PORT);
  }
  for (let p = PORT_START; p <= PORT_END; p += 1) {
    if (!ports.includes(p)) ports.push(p);
  }

  let fallbackAny = null;
  let fallbackNonHeadless = null;
  let fallbackOmsBase = null;
  for (const port of ports) {
    try {
      const versionResp = await fetch(`http://127.0.0.1:${port}/json/version`, { method: 'GET' });
      if (!versionResp.ok) continue;
      const versionData = await versionResp.json();
      if (!versionData || !versionData.webSocketDebuggerUrl) continue;
      const ua = String(versionData['User-Agent'] || '');
      const browserText = String(versionData.Browser || '');
      const isHeadless = /HeadlessChrome/i.test(ua) || /HeadlessChrome/i.test(browserText);

      const listResp = await fetch(`http://127.0.0.1:${port}/json/list`, { method: 'GET' });
      if (!listResp.ok) {
        if (!fallbackAny) fallbackAny = { browserURL: `http://127.0.0.1:${port}`, port };
        if (!isHeadless && !fallbackNonHeadless) {
          fallbackNonHeadless = { browserURL: `http://127.0.0.1:${port}`, port };
        }
        continue;
      }
      const targets = await listResp.json();
      const hasOmsTarget = Array.isArray(targets)
        ? targets.some(
            (t) =>
              t &&
              t.type === 'page' &&
              typeof t.url === 'string' &&
              t.url.includes(TARGET_URL_FRAGMENT)
          )
        : false;
      const hasOmsBaseTarget = Array.isArray(targets)
        ? targets.some(
            (t) =>
              t &&
              t.type === 'page' &&
              typeof t.url === 'string' &&
              t.url.includes(OMS_BASE_FRAGMENT)
          )
        : false;

      if (hasOmsTarget) {
        return { browserURL: `http://127.0.0.1:${port}`, port };
      }
      if (hasOmsBaseTarget && !fallbackOmsBase) {
        fallbackOmsBase = { browserURL: `http://127.0.0.1:${port}`, port };
      }
      if (!isHeadless && !fallbackNonHeadless) {
        fallbackNonHeadless = { browserURL: `http://127.0.0.1:${port}`, port };
      }
      if (!fallbackAny) fallbackAny = { browserURL: `http://127.0.0.1:${port}`, port };
    } catch {
      // Try next port.
    }
  }

  if (fallbackOmsBase) return fallbackOmsBase;
  if (fallbackNonHeadless) return fallbackNonHeadless;
  if (fallbackAny) return fallbackAny;
  throw new Error(`No CDP browser found on 127.0.0.1 ports ${PORT_START}-${PORT_END}. Start OMS launcher first.`);
}

async function findOmsPage(browser) {
  const pages = await browser.pages();
  return (
    pages.find((p) => (p.url() || '').includes(TARGET_URL_FRAGMENT)) ||
    pages.find((p) => (p.url() || '').includes(OMS_BASE_FRAGMENT)) ||
    null
  );
}

async function clickByBoundingBox(page, selector) {
  const handle = await page.$(selector);
  if (!handle) return false;
  const box = await handle.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 30 });
  return true;
}

async function ensurePageSize(page, desiredSize) {
  await page.waitForSelector('span.el-pagination__sizes .el-input__inner', {
    visible: true,
    timeout: 20_000
  });

  const current = await page.evaluate(() => {
    const el = document.querySelector('span.el-pagination__sizes .el-input__inner');
    return Number(String(el?.value || el?.textContent || '').replace(/[^\d]/g, ''));
  });
  if (current === desiredSize) return { changed: false, current };

  const opened = await clickByBoundingBox(page, 'span.el-pagination__sizes .el-input__inner');
  if (!opened) {
    throw new Error('Failed to click pagination size trigger.');
  }

  await page.waitForFunction(() => {
    const nodes = Array.from(document.querySelectorAll('div.el-select-dropdown.el-popper'));
    return nodes.some((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 10 && r.height > 10;
    });
  }, { timeout: 10_000 });

  const selectResult = await page.evaluate((targetSize) => {
    const visibleDropdowns = Array.from(document.querySelectorAll('div.el-select-dropdown.el-popper')).filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 10 && r.height > 10;
    });
    if (!visibleDropdowns.length) return { ok: false, reason: 'dropdown_not_visible' };

    const dropdown = visibleDropdowns[visibleDropdowns.length - 1];
    const items = Array.from(dropdown.querySelectorAll('li, .el-select-dropdown__item, span'));
    const target = items.find((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const numeric = Number(text.replace(/[^\d]/g, ''));
      return numeric === targetSize;
    });
    if (!target) return { ok: false, reason: 'target_option_not_found' };

    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.click();
    return { ok: true, clickedText: (target.textContent || '').replace(/\s+/g, ' ').trim() };
  }, desiredSize);

  if (!selectResult.ok) {
    throw new Error(`Failed to set page size ${desiredSize}: ${selectResult.reason}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
  const finalSize = await page.evaluate(() => {
    const el = document.querySelector('span.el-pagination__sizes .el-input__inner');
    return Number(String(el?.value || el?.textContent || '').replace(/[^\d]/g, ''));
  });
  if (finalSize !== desiredSize) {
    throw new Error(`Page size did not apply. expected=${desiredSize} actual=${finalSize}`);
  }
  return { changed: true, current: finalSize };
}

async function clickOmsTabMinusOne(page) {
  await page.waitForSelector('#tab--1', { visible: true, timeout: 20_000 });
  const alreadyActive = await page.evaluate(() => {
    const tab = document.querySelector('#tab--1');
    return !!tab && tab.classList.contains('is-active');
  });
  if (alreadyActive) {
    return;
  }

  let activated = false;
  for (let i = 0; i < 3 && !activated; i += 1) {
    await clickByBoundingBox(page, '#tab--1');
    await page.evaluate(() => {
      const tab = document.querySelector('#tab--1');
      if (tab) {
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        tab.click();
      }
    });

    try {
      await page.waitForFunction(() => {
        const tab = document.querySelector('#tab--1');
        return !!tab && tab.classList.contains('is-active');
      }, { timeout: 7_000 });
      activated = true;
    } catch {
      // Retry click if activation did not stick.
    }
  }

  if (!activated) {
    throw new Error('Failed to activate tab #tab--1.');
  }
}

async function waitForTableRowsStable(page, {
  minStableSamples = 2,
  sampleIntervalMs = 250,
  timeoutMs = 20_000,
  requirePositive = false
} = {}) {
  const started = Date.now();
  let lastCount = null;
  let stableSamples = 0;

  while (Date.now() - started < timeoutMs) {
    const rowCount = await page.evaluate(() => {
      const selectors = ['.vxe-table--body tbody tr', '.vxe-table--body-wrapper tbody tr', '.el-table__body-wrapper tbody tr'];
      for (const sel of selectors) {
        const rows = Array.from(document.querySelectorAll(sel)).filter((el) => {
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.height > 0;
        });
        if (rows.length > 0 || document.querySelector(sel)) {
          return rows.length;
        }
      }
      return 0;
    });

    if (lastCount === rowCount) {
      stableSamples += 1;
    } else {
      stableSamples = 1;
      lastCount = rowCount;
    }

    if (stableSamples >= minStableSamples && (!requirePositive || rowCount > 0)) {
      return { rowCount, stableSamples, stabilizedAt: Date.now() };
    }
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
  }

  throw new Error('Table rows did not stabilize in time.');
}

async function extractRowsFromMainTable(page, expectedRows = 0) {
  return page.evaluate(async (targetRows) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const startedAt = Date.now();
    const mainWrapper = document.querySelector('div.vxe-table--main-wrapper');
    if (!mainWrapper) {
      return { ok: false, reason: 'main_wrapper_not_found', rows: [] };
    }

    // Explicit step requested in chain: scroll page to bottom first.
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(120);

    const bodyWrapper =
      mainWrapper.querySelector('.vxe-table--body-wrapper') ||
      mainWrapper.querySelector('.vxe-table--body')?.parentElement ||
      mainWrapper;

    const deepText = (node) => {
      if (!node) return '';
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      const chunks = [];
      let current = walker.nextNode();
      while (current) {
        const text = (current.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (text) chunks.push(text);
        current = walker.nextNode();
      }
      return chunks.join(' ').replace(/\s+/g, ' ').trim();
    };

    const headers = Array.from(mainWrapper.querySelectorAll('thead th')).map((th, idx) => {
      const label = deepText(th);
      return label || `col_${idx + 1}`;
    });

    const rowMap = new Map();
    const harvestVisibleRows = () => {
      const rows = Array.from(mainWrapper.querySelectorAll('tbody tr'));
      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (!tds.length) continue;
        const cellValues = tds.map((td) => deepText(td));
        const rowObj = {};
        for (let i = 0; i < cellValues.length; i += 1) {
          const key = headers[i] || `col_${i + 1}`;
          rowObj[key] = cellValues[i];
        }
        rowObj.__rowid =
          tr.getAttribute('rowid') ||
          tr.getAttribute('data-rowid') ||
          tr.id ||
          '';
        rowObj.__row_hash = cellValues.join('|');

        const key = rowObj.__rowid || rowObj.__row_hash;
        if (key && !rowMap.has(key)) {
          rowMap.set(key, rowObj);
        }
      }
    };

    // Crawl table body by scrolling from top to bottom to collect virtualized rows.
    if (bodyWrapper && typeof bodyWrapper.scrollTop === 'number') {
      bodyWrapper.scrollTop = 0;
      await sleep(80);
      harvestVisibleRows();

      const maxScrollTop = Math.max(0, bodyWrapper.scrollHeight - bodyWrapper.clientHeight);
      const firstRowHeight =
        mainWrapper.querySelector('tbody tr')?.getBoundingClientRect()?.height || 34;
      const viewportHeight = Math.max(bodyWrapper.clientHeight || 0, firstRowHeight * 25);
      const primaryStep = Math.max(80, Math.floor(viewportHeight * 0.92));
      let guard = 0;
      while (bodyWrapper.scrollTop < maxScrollTop && guard < 400) {
        const nextTop = Math.min(maxScrollTop, bodyWrapper.scrollTop + primaryStep);
        bodyWrapper.scrollTop = nextTop;
        await sleep(45);
        harvestVisibleRows();
        if (targetRows > 0 && rowMap.size >= targetRows) {
          break;
        }
        guard += 1;
      }
      // Also harvest once at absolute bottom.
      bodyWrapper.scrollTop = maxScrollTop;
      await sleep(55);
      harvestVisibleRows();

      // Safety pass: if targetRows not reached, scan again at finer step to avoid misses.
      if (targetRows > 0 && rowMap.size < targetRows && maxScrollTop > 0) {
        const secondaryStep = Math.max(40, Math.floor(primaryStep / 2));
        for (let top = 0; top <= maxScrollTop; top += secondaryStep) {
          bodyWrapper.scrollTop = top;
          await sleep(30);
          harvestVisibleRows();
          if (rowMap.size >= targetRows) break;
        }
      }
    } else {
      harvestVisibleRows();
    }

    return {
      ok: true,
      headersCount: headers.length,
      rows: Array.from(rowMap.values()),
      elapsedMs: Date.now() - startedAt,
      bodyScrollTop: bodyWrapper && typeof bodyWrapper.scrollTop === 'number' ? bodyWrapper.scrollTop : null,
      bodyScrollHeight: bodyWrapper && typeof bodyWrapper.scrollHeight === 'number' ? bodyWrapper.scrollHeight : null
    };
  }, Number(expectedRows || 0));
}

function updateIncrementalParquetWithPython({
  inputJsonPath,
  outputParquetPath,
  captureTimestamp,
  keyCandidates = ['平台单号', 'orderNo', 'platformOrderNo', '__rowid', '__row_hash']
}) {
  const tempScriptPath = path.join(path.dirname(outputParquetPath), `tmp_upsert_${Date.now()}.py`);
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

def _normalize_key_series(series):
    return (
        series.astype(str)
        .str.replace(r"\\s+", " ", regex=True)
        .str.strip()
        .replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    )

pk = next((k for k in key_candidates if k in new_df.columns or k in old_df.columns), None)
if pk:
    if pk in new_df.columns:
        new_df[pk] = _normalize_key_series(new_df[pk])
    if not old_df.empty and pk in old_df.columns:
        old_df[pk] = _normalize_key_series(old_df[pk])

    # Keep newest row per key inside this capture batch first.
    if pk in new_df.columns:
        new_df = new_df.dropna(subset=[pk]).drop_duplicates(subset=[pk], keep="last")

    if old_df.empty:
        merged = new_df.copy()
    else:
        # Replace cache entries whose keys appear in new_df, preserving all other cached rows.
        if pk in old_df.columns and pk in new_df.columns and not new_df.empty:
            old_kept = old_df[~old_df[pk].isin(set(new_df[pk].dropna().tolist()))]
        else:
            old_kept = old_df
        merged = pd.concat([old_kept, new_df], ignore_index=True, sort=False)
else:
    # Robust fallback for DOM-sourced rows without a key column: replace by full-row hash.
    def _mk_row_key(row):
        text = json.dumps(row.to_dict(), ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.md5(text.encode("utf-8")).hexdigest()

    new_df["_row_key"] = new_df.apply(_mk_row_key, axis=1)
    if old_df.empty:
        merged = new_df.copy()
    else:
        if "_row_key" not in old_df.columns:
            old_df["_row_key"] = old_df.apply(_mk_row_key, axis=1)
        old_kept = old_df[~old_df["_row_key"].isin(set(new_df["_row_key"].tolist()))]
        merged = pd.concat([old_kept, new_df], ignore_index=True, sort=False)

if "_captured_at" in merged.columns:
    merged = merged.sort_values(by=["_captured_at"], kind="stable")

out.parent.mkdir(parents=True, exist_ok=True)
merged.to_parquet(out, index=False, engine="pyarrow")
print(str(out))
print(f"rows={len(merged)} cols={len(merged.columns)} pk={pk}")
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
    throw new Error(`Parquet write failed via python. stdout=${stdout} stderr=${stderr}`);
  }
  return (result.stdout || '').trim();
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
  keyCandidates = ['平台单号', 'orderNo', 'platformOrderNo', '__rowid', '__row_hash']
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
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  let browser;
  let port = null;
  let browserURL = null;
  for (let attempt = 1; attempt <= CDP_SELECT_RETRIES; attempt += 1) {
    ({ browserURL, port } = await findWorkingBrowserURL());
    try {
      browser = await puppeteer.connect({
        browserURL,
        defaultViewport: null,
        protocolTimeout: CDP_CONNECT_TIMEOUT_MS
      });
      break;
    } catch (error) {
      if (attempt >= CDP_SELECT_RETRIES) {
        throw error;
      }
      await sleep(CDP_SELECT_RETRY_DELAY_MS);
    }
  }

  try {
    let page = await findOmsPage(browser);
    if (!page) {
      page = await browser.newPage();
      await page.goto(OMS_ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    }
    await page.bringToFront();
    if (!(page.url() || '').includes(TARGET_URL_FRAGMENT)) {
      await page.goto(OMS_ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => null);

    let tabActivationWarning = '';
    try {
      await clickOmsTabMinusOne(page);
    } catch (error) {
      tabActivationWarning = String(error?.message || error || '');
    }
    await page.waitForSelector('.vxe-table--body, .vxe-table--body-wrapper, .el-table__body-wrapper', {
      timeout: 20_000
    }).catch(() => null);

    let sizeState = { changed: false, current: null };
    let pageSizeWarning = '';
    if (ENSURE_PAGE_SIZE_EACH_TICK) {
      try {
        sizeState = await ensurePageSize(page, TARGET_PAGE_SIZE);
      } catch (error) {
        pageSizeWarning = String(error?.message || error || '');
      }
    }
    const stableState = await waitForTableRowsStable(page, {
      requirePositive: false,
      minStableSamples: 2,
      sampleIntervalMs: 250,
      timeoutMs: 35_000
    });
    const extracted = await extractRowsFromMainTable(page, TARGET_PAGE_SIZE);
    if (!extracted.ok) {
      throw new Error(`DOM table extraction failed: ${extracted.reason}`);
    }
    const capturedAt = new Date().toISOString();
    const domRows = Array.isArray(extracted.rows) ? extracted.rows : [];

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rowsTmpJsonPath = path.join(OUTPUT_DIR, `oms_orders_cache_${ts}.rows.tmp.json`);
    const metaTmpJsonPath = path.join(OUTPUT_DIR, `oms_orders_cache_${ts}.meta.tmp.json`);
    const latestParquetPath = path.join(OUTPUT_DIR, 'oms_orders_cache.parquet');
    const metaParquetPath = path.join(OUTPUT_DIR, 'oms_orders_cache_meta.parquet');

    await fsp.writeFile(rowsTmpJsonPath, JSON.stringify(domRows), 'utf8');

    const parquetUpdateResult = updateIncrementalParquetWithPythonV2({
      inputJsonPath: rowsTmpJsonPath,
      outputParquetPath: latestParquetPath,
      captureTimestamp: capturedAt
    });

    const metaRecord = {
      capturedAt,
      cdpPort: Number(port),
      source: 'dom.vxe-table--main-wrapper',
      pageSizeTarget: Number(TARGET_PAGE_SIZE),
      pageSizeChanged: !!sizeState.changed,
      tableRowsStableCount: Number(stableState.rowCount),
      tableRowsStableSamples: Number(stableState.stableSamples),
      headersCount: Number(extracted.headersCount || 0),
      bodyScrollTop: Number(extracted.bodyScrollTop || 0),
      bodyScrollHeight: Number(extracted.bodyScrollHeight || 0),
      extractedRowCount: Number(domRows.length),
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

    console.log(`CDP port: ${port}`);
    if (ENSURE_PAGE_SIZE_EACH_TICK) {
      console.log(`Page size ensured: ${TARGET_PAGE_SIZE} (changed=${sizeState.changed ? 1 : 0})`);
    } else {
      console.log(`Page size step skipped on tick (OMS_ENSURE_PAGE_SIZE_EACH_TICK=0).`);
    }
    if (tabActivationWarning) {
      console.warn(`OMS tab activation warning: ${tabActivationWarning}`);
    }
    if (pageSizeWarning) {
      console.warn(`OMS page size warning: ${pageSizeWarning}`);
    }
    console.log(`Table rows stabilized: count=${stableState.rowCount}, samples=${stableState.stableSamples}`);
    console.log(`DOM rows extracted this refresh: ${domRows.length}`);
    console.log(`DOM extraction elapsed ms: ${extracted.elapsedMs}`);
    console.log(`Incremental parquet: ${latestParquetPath}`);
    console.log(`Parquet update: ${JSON.stringify(parquetUpdateResult)}`);
    console.log(`Meta parquet: ${metaParquetPath}`);
    console.log(`Meta parquet update: ${metaParquetUpdateResult}`);
  } finally {
    await browser.disconnect();
  }
}

main().catch((error) => {
  console.error(`refresh_and_cache_oms_orders_parquet failed: ${error.message || error}`);
  process.exit(1);
});
