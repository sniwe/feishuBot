const fs = require('fs/promises');
const path = require('path');
const dns = require('dns');
const https = require('https');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_ENDPOINT = 'https://trendyadventurer.wixstudio.com/tb-redo/_functions/getAllOrdersLastNDays';
const DEFAULT_FORCE_HOST = 'trendyadventurer.wixstudio.com';
const DEFAULT_FORCE_IP = '34.8.133.164';
const DEFAULT_OUTPUT_DIR = path.resolve(WORKSPACE_ROOT, 'mgmt', 'dev', 'tests');

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

function getTimestampCompact() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && Number.isInteger(n) && n > 0) return n;
  return fallback;
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

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function parseInput(ctx) {
  const { data = {} } = ctx;
  const shopRoomCode = String(data.shopRoomCode || '').trim();
  if (!shopRoomCode) throw new Error('Missing shopRoomCode. Pass --shopRoomCode=LG401');

  const endpointUrl = String(data.endpointUrl || DEFAULT_ENDPOINT).trim();
  const days = toPositiveInt(data.days, 1);
  if (!days) throw new Error('days must be a positive integer');

  const forceHost = String(data.forceHost || DEFAULT_FORCE_HOST).trim();
  const forceIp = String(data.forceIp || DEFAULT_FORCE_IP).trim();
  const outputDir = String(data.outputDir || DEFAULT_OUTPUT_DIR).trim();
  const outputPath = String(data.outputPath || '').trim();

  return { shopRoomCode, endpointUrl, days, forceHost, forceIp, outputDir, outputPath };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function buildUrl(ctx) {
  const { data = {} } = ctx;
  const url = new URL(String(data.endpointUrl));
  url.searchParams.set('shopRoomCode', String(data.shopRoomCode));
  url.searchParams.set('days', String(data.days));
  return url;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function performHttpsGet(ctx) {
  const { data = {}, deps } = ctx;
  const { lookup } = deps;
  const url = data.url;

  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      keepAlive: false,
      lookup
    });

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
          'User-Agent': 'oms-tiktok-lastndays-fetch/1.0'
        },
        timeout: 25000,
        agent
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: Number(res.statusCode || 0),
            statusMessage: String(res.statusMessage || ''),
            headers: res.headers || {},
            body
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function fetchPayload(ctx) {
  const { data = {} } = ctx;
  const url = buildUrl({ data });

  // First try normal DNS; fallback to forced host IP on network timeout/resolution failures.
  const first = await performHttpsGet({
    data: { url },
    deps: { lookup: dns.lookup }
  }).catch((error) => ({ error }));

  if (!first.error) return { url, ...first, usedForcedLookup: false };

  const fallbackLookup = createForcedLookup(data.forceHost, data.forceIp);
  const second = await performHttpsGet({
    data: { url },
    deps: { lookup: fallbackLookup }
  });
  return { url, ...second, usedForcedLookup: true };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function saveResult(ctx) {
  const { data = {}, deps } = ctx;
  const { fsApi } = deps;
  await fsApi.mkdir(data.outputDir, { recursive: true });

  const outPath =
    data.outputPath ||
    path.join(
      data.outputDir,
      `tiktok-allorderslastndays-${data.shopRoomCode}-days${data.days}-${getTimestampCompact()}.json`
    );
  await fsApi.writeFile(outPath, JSON.stringify(data.payload, null, 2), 'utf8');
  return outPath;
}

async function run() {
  const input = parseInput({
    data: {
      shopRoomCode: readArg('shopRoomCode', readArg('shop', '')),
      days: readArg('days', process.env.OMS_TIKTOK_DAYS || '1'),
      endpointUrl: readArg('endpoint', process.env.OMS_TIKTOK_ORDERS_ENDPOINT || DEFAULT_ENDPOINT),
      forceHost: readArg('forceHost', process.env.OMS_TIKTOK_FORCE_HOST || DEFAULT_FORCE_HOST),
      forceIp: readArg('forceIp', process.env.OMS_TIKTOK_FORCE_IP || DEFAULT_FORCE_IP),
      outputDir: readArg('outDir', process.env.OMS_TIKTOK_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
      outputPath: readArg('out', process.env.OMS_TIKTOK_OUTPUT_PATH || '')
    }
  });

  const response = await fetchPayload({
    data: input
  });

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const detail = stripBom(response.body || '').slice(0, 4000);
    throw new Error(`Order fetch failed (${response.statusCode}) ${response.statusMessage} ${detail}`);
  }

  let payload = null;
  try {
    payload = JSON.parse(stripBom(response.body));
  } catch (error) {
    throw new Error(`Expected JSON payload but got parse error: ${error.message}`);
  }

  const outputPath = await saveResult({
    data: {
      ...input,
      payload
    },
    deps: {
      fsApi: fs
    }
  });

  const ordersCount = Array.isArray(payload)
    ? payload.length
    : Array.isArray(payload?.orders)
      ? payload.orders.length
      : Array.isArray(payload?.data)
        ? payload.data.length
        : 0;

  console.log(`[tiktok-lastndays] url=${response.url}`);
  console.log(`[tiktok-lastndays] shopRoomCode=${input.shopRoomCode} days=${input.days}`);
  console.log(`[tiktok-lastndays] usedForcedLookup=${response.usedForcedLookup ? '1' : '0'}`);
  console.log(`[tiktok-lastndays] orders_count=${ordersCount}`);
  console.log(`[tiktok-lastndays] saved=${outputPath}`);
}

run().catch((error) => {
  console.error(`[tiktok-lastndays] ${error?.message || error}`);
  process.exitCode = 1;
});
