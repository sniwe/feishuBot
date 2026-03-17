const fs = require('fs/promises');
const path = require('path');
const dns = require('dns');
const https = require('https');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_ENDPOINT = 'https://trendyadventurer.wixstudio.com/tb-redo/_functions/getAllOrdersLastNDays';
const DEFAULT_FORCE_HOST = 'trendyadventurer.wixstudio.com';
const DEFAULT_FORCE_IP = '34.8.133.164';
const DEFAULT_ORDER_ROOT = path.resolve(WORKSPACE_ROOT, 'src', 'backend', 'oms', 'data', 'orders');
const AUGMENT_FIELDS = ['original_total_product_price', 'sub_total', 'total_amount'];

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const direct = process.argv.find((value) => value.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && Number.isInteger(n) && n > 0) return n;
  return fallback;
}

function normalizePrefix(store) {
  const raw = String(store || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('LG')) return raw.slice(2);
  return raw;
}

function createForcedLookup(forceHost, forceIp) {
  return (hostname, options, callback) => {
    let resolvedOptions = options;
    let resolvedCallback = callback;
    if (typeof resolvedOptions === 'function') {
      resolvedCallback = resolvedOptions;
      resolvedOptions = {};
    }
    if (hostname === forceHost && forceIp) {
      if (resolvedOptions && resolvedOptions.all) {
        resolvedCallback(null, [{ address: forceIp, family: 4 }]);
        return;
      }
      resolvedCallback(null, forceIp, 4);
      return;
    }
    dns.lookup(hostname, resolvedOptions, resolvedCallback);
  };
}

async function performHttpsGet(url, lookup) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ keepAlive: false, lookup });
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Host: url.host,
          'User-Agent': 'oms-tiktok-pricing-augment/1.0'
        },
        timeout: 25000,
        agent
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: Number(res.statusCode || 0),
            statusMessage: String(res.statusMessage || ''),
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchTikTokOrders({ endpointUrl, shopRoomCode, days, forceHost, forceIp }) {
  const url = new URL(String(endpointUrl || DEFAULT_ENDPOINT));
  url.searchParams.set('shopRoomCode', String(shopRoomCode));
  url.searchParams.set('days', String(days));

  const first = await performHttpsGet(url, dns.lookup).catch((error) => ({ error }));
  let response = first;
  let usedForcedLookup = false;
  if (first.error) {
    const lookup = createForcedLookup(forceHost, forceIp);
    response = await performHttpsGet(url, lookup);
    usedForcedLookup = true;
  }

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `TikTok fetch failed for ${shopRoomCode} (${response.statusCode || 0}) ${response.statusMessage || ''}`
    );
  }

  let payload = null;
  try {
    payload = JSON.parse(stripBom(response.body || ''));
  } catch (error) {
    throw new Error(`TikTok payload parse failed for ${shopRoomCode}: ${error.message}`);
  }

  const orders = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.orders)
      ? payload.orders
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return { payload, orders, url: url.toString(), usedForcedLookup };
}

function getLatestDateDirName(entries) {
  const names = entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  return names[0] || '';
}

function collectOrderKeys(order) {
  return [
    order?.id,
    order?.order_id,
    order?.orderId,
    order?.order_no,
    order?.orderNo,
    order?.platform_order_no,
    order?.platformOrderNo
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function buildOrderIndex(orders) {
  const map = new Map();
  for (const order of orders || []) {
    for (const key of collectOrderKeys(order)) {
      if (!map.has(key)) map.set(key, order);
    }
  }
  return map;
}

function collectRowKeys(row) {
  return [row?.platformOrderNo, row?.orderNo, row?.rowId].map((v) => String(v || '').trim()).filter(Boolean);
}

function getPaymentPatch(order) {
  const payment = order?.payment || {};
  const patch = {};
  for (const key of AUGMENT_FIELDS) {
    const value = payment[key];
    if (value == null || value === '') continue;
    patch[key] = value;
  }
  return patch;
}

async function resolveTargetFiles(orderRoot, dateDirName, storePrefix) {
  const entries = await fs.readdir(orderRoot, { withFileTypes: true });
  const resolvedDateDir = String(dateDirName || '').trim() || getLatestDateDirName(entries);
  if (!resolvedDateDir) throw new Error(`No YYMMDD directory found under ${orderRoot}`);
  const dateDir = path.join(orderRoot, resolvedDateDir);
  const files = await fs.readdir(dateDir, { withFileTypes: true });
  const jsonFiles = files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name);

  const targets = [];
  for (const fileName of jsonFiles) {
    const prefix = path.basename(fileName, '.json');
    if (!/^\d+$/.test(prefix)) continue;
    if (storePrefix && prefix !== storePrefix) continue;
    targets.push({
      prefix,
      shopRoomCode: `LG${prefix}`,
      filePath: path.join(dateDir, fileName)
    });
  }
  return { resolvedDateDir, targets };
}

async function augmentFile({ filePath, orderMap }) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(stripBom(raw));
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  let matched = 0;
  let updated = 0;

  for (const row of rows) {
    const keys = collectRowKeys(row);
    let matchedOrder = null;
    for (const key of keys) {
      if (orderMap.has(key)) {
        matchedOrder = orderMap.get(key);
        break;
      }
    }
    if (!matchedOrder) continue;
    matched += 1;

    const patch = getPaymentPatch(matchedOrder);
    if (!Object.keys(patch).length) continue;
    let changed = false;
    for (const [field, value] of Object.entries(patch)) {
      if (row[field] !== value) {
        row[field] = value;
        changed = true;
      }
    }
    if (changed) updated += 1;
  }

  if (updated > 0) {
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  }
  return { matched, updated, totalRows: rows.length };
}

async function main() {
  const input = {
    endpointUrl: readArg('endpoint', process.env.OMS_TIKTOK_ORDERS_ENDPOINT || DEFAULT_ENDPOINT),
    forceHost: readArg('forceHost', process.env.OMS_TIKTOK_FORCE_HOST || DEFAULT_FORCE_HOST),
    forceIp: readArg('forceIp', process.env.OMS_TIKTOK_FORCE_IP || DEFAULT_FORCE_IP),
    days: toPositiveInt(readArg('days', process.env.OMS_TIKTOK_DAYS || '1'), 1),
    orderRoot: readArg('orderRoot', DEFAULT_ORDER_ROOT),
    dateDirName: readArg('date', ''),
    storePrefix: normalizePrefix(readArg('store', readArg('shopRoomCode', '')))
  };

  const { resolvedDateDir, targets } = await resolveTargetFiles(input.orderRoot, input.dateDirName, input.storePrefix);
  if (!targets.length) {
    throw new Error(`No matching store json files under ${path.join(input.orderRoot, resolvedDateDir)}`);
  }

  const fetchCache = new Map();
  const summary = [];
  for (const target of targets) {
    if (!fetchCache.has(target.shopRoomCode)) {
      fetchCache.set(
        target.shopRoomCode,
        await fetchTikTokOrders({
          endpointUrl: input.endpointUrl,
          shopRoomCode: target.shopRoomCode,
          days: input.days,
          forceHost: input.forceHost,
          forceIp: input.forceIp
        })
      );
    }
    const tk = fetchCache.get(target.shopRoomCode);
    const orderMap = buildOrderIndex(tk.orders);
    const result = await augmentFile({
      filePath: target.filePath,
      orderMap
    });
    summary.push({
      shopRoomCode: target.shopRoomCode,
      filePath: target.filePath,
      fetchedOrders: tk.orders.length,
      usedForcedLookup: tk.usedForcedLookup,
      matchedRows: result.matched,
      updatedRows: result.updated,
      totalRows: result.totalRows
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        resolvedDateDir,
        days: input.days,
        targets: summary
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});

