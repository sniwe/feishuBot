const fs = require('fs/promises');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_ORDER_ROOT = path.resolve(WORKSPACE_ROOT, 'src', 'backend', 'oms', 'data', 'orders');
const DELIVERY_FIELDS = [
  'receiver',
  'telephone',
  'receiptCountryCode',
  'receiptCountryName',
  'provinceCode',
  'provinceName',
  'city',
  'postCode',
  'houseNum',
  'addressOne',
  'addressTwo',
  'addressThi'
];

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function readArg(ctx) {
  const { data = {} } = ctx;
  const { name, fallback = '' } = data;
  const prefix = `--${name}=`;
  const direct = process.argv.find((value) => value.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function stripBom(ctx) {
  const { data = {} } = ctx;
  return String(data.value || '').replace(/^\uFEFF/, '');
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function normalizeString(ctx) {
  const { data = {} } = ctx;
  return String(data.value == null ? '' : data.value).trim();
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function isFalsyAuditTime(ctx) {
  const { data = {} } = ctx;
  const value = data.value;
  if (!value) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  return false;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function pickDeliveryInfo(ctx) {
  const { data = {} } = ctx;
  const row = data.row || {};
  const out = {};
  for (const key of DELIVERY_FIELDS) {
    const normalized = normalizeString({ data: { value: row[key] }, deps: {} });
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function stableObjectKey(ctx) {
  const { data = {} } = ctx;
  const value = data.value || {};
  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => [key, value[key]]);
  return JSON.stringify(pairs);
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function resolveOrderId(ctx) {
  const { data = {} } = ctx;
  const row = data.row || {};
  const candidates = [row.orderNo, row.platformOrderNo, row.rowId, row.id, row.orderId];
  for (const candidate of candidates) {
    const normalized = normalizeString({ data: { value: candidate }, deps: {} });
    if (normalized) return normalized;
  }
  return '';
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function resolveRecentDateDirs(ctx) {
  const { data = {}, deps } = ctx;
  const fsApi = deps.fsApi;
  const orderRoot = data.orderRoot;
  const maxDates = Number(data.maxDates || 2);
  const entries = await fsApi.readdir(orderRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, maxDates);
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function listJsonFilesForDates(ctx) {
  const { data = {}, deps } = ctx;
  const fsApi = deps.fsApi;
  const orderRoot = data.orderRoot;
  const dateDirs = data.dateDirs || [];
  const out = [];
  for (const dateDir of dateDirs) {
    const fullDir = path.join(orderRoot, dateDir);
    const files = await fsApi.readdir(fullDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      if (!file.name.toLowerCase().endsWith('.json')) continue;
      out.push(path.join(fullDir, file.name));
    }
  }
  return out;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function loadRows(ctx) {
  const { data = {}, deps } = ctx;
  const fsApi = deps.fsApi;
  const filePath = data.filePath;
  const raw = await fsApi.readFile(filePath, 'utf8');
  const parsed = JSON.parse(stripBom({ data: { value: raw }, deps: {} }));
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  return { parsed, rows };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function collectCandidates(ctx) {
  const { data = {} } = ctx;
  const rows = data.rows || [];
  const filePath = data.filePath;
  const candidates = [];
  let skippedNoDeliveryFields = 0;

  for (const row of rows) {
    if (!isFalsyAuditTime({ data: { value: row?.auditTime }, deps: {} })) continue;
    const deliveryInfo = pickDeliveryInfo({ data: { row }, deps: {} });
    if (!Object.keys(deliveryInfo).length) {
      skippedNoDeliveryFields += 1;
      continue;
    }
    const orderId = resolveOrderId({ data: { row }, deps: {} });
    if (!orderId) continue;
    const groupKey = stableObjectKey({ data: { value: deliveryInfo }, deps: {} });
    candidates.push({
      row,
      filePath,
      orderId,
      groupKey
    });
  }

  return { candidates, skippedNoDeliveryFields };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function buildGroupMap(ctx) {
  const { data = {} } = ctx;
  const allCandidates = data.allCandidates || [];
  const groupMap = new Map();
  for (const item of allCandidates) {
    if (!groupMap.has(item.groupKey)) groupMap.set(item.groupKey, []);
    groupMap.get(item.groupKey).push(item);
  }
  return groupMap;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function applyNeedsCombine(ctx) {
  const { data = {} } = ctx;
  const groupMap = data.groupMap;
  const dryRun = Boolean(data.dryRun);
  const changedFiles = new Set();
  const groupsApplied = [];

  for (const [, group] of groupMap.entries()) {
    if (!Array.isArray(group) || group.length < 2) continue;
    const orderIds = Array.from(new Set(group.map((item) => item.orderId))).sort((a, b) => a.localeCompare(b));
    for (const item of group) {
      const before = Array.isArray(item.row.needsCombine) ? item.row.needsCombine : null;
      const same =
        Array.isArray(before) &&
        before.length === orderIds.length &&
        before.every((value, idx) => value === orderIds[idx]);
      if (!same) {
        if (!dryRun) item.row.needsCombine = orderIds;
        changedFiles.add(item.filePath);
      }
    }
    groupsApplied.push({
      size: group.length,
      orderIds
    });
  }

  return { changedFiles: Array.from(changedFiles), groupsApplied };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function writeChangedFiles(ctx) {
  const { data = {}, deps } = ctx;
  const fsApi = deps.fsApi;
  const parsedByFile = data.parsedByFile || new Map();
  const changedFiles = data.changedFiles || [];
  for (const filePath of changedFiles) {
    const parsed = parsedByFile.get(filePath);
    if (!parsed) continue;
    await fsApi.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  }
}

async function main() {
  const orderRoot = readArg({
    data: { name: 'orderRoot', fallback: process.env.OMS_ORDER_ROOT || DEFAULT_ORDER_ROOT },
    deps: {}
  });
  const dryRun = ['1', 'true', 'yes'].includes(
    String(readArg({ data: { name: 'dryRun', fallback: '' }, deps: {} })).trim().toLowerCase()
  );

  const recentDateDirs = await resolveRecentDateDirs({
    data: { orderRoot, maxDates: 2 },
    deps: { fsApi: fs }
  });
  if (!recentDateDirs.length) {
    throw new Error(`No YYMMDD date directories found under ${orderRoot}`);
  }

  const jsonFiles = await listJsonFilesForDates({
    data: { orderRoot, dateDirs: recentDateDirs },
    deps: { fsApi: fs }
  });
  if (!jsonFiles.length) {
    throw new Error(`No .json files found in recent date directories under ${orderRoot}`);
  }

  const parsedByFile = new Map();
  const allCandidates = [];
  let scannedRows = 0;
  let skippedNoDeliveryFields = 0;

  for (const filePath of jsonFiles) {
    const loaded = await loadRows({
      data: { filePath },
      deps: { fsApi: fs }
    });
    parsedByFile.set(filePath, loaded.parsed);
    scannedRows += loaded.rows.length;
    const collected = collectCandidates({
      data: { rows: loaded.rows, filePath },
      deps: {}
    });
    skippedNoDeliveryFields += collected.skippedNoDeliveryFields;
    allCandidates.push(...collected.candidates);
  }

  const groupMap = buildGroupMap({
    data: { allCandidates },
    deps: {}
  });
  const applied = applyNeedsCombine({
    data: {
      groupMap,
      dryRun
    },
    deps: {}
  });

  if (!dryRun && applied.changedFiles.length) {
    await writeChangedFiles({
      data: {
        parsedByFile,
        changedFiles: applied.changedFiles
      },
      deps: { fsApi: fs }
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderRoot,
        dryRun,
        dateDirs: recentDateDirs,
        filesScanned: jsonFiles.length,
        scannedRows,
        falseyAuditCandidates: allCandidates.length,
        skippedNoDeliveryFields,
        groupsFound: applied.groupsApplied.length,
        changedFiles: applied.changedFiles,
        groupsApplied: applied.groupsApplied
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
