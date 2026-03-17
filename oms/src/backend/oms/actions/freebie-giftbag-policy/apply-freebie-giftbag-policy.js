const fs = require('fs/promises');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_ORDER_ROOT = path.resolve(WORKSPACE_ROOT, 'src', 'backend', 'oms', 'data', 'orders');
const DEFAULT_CONFIG_PATH = path.resolve(WORKSPACE_ROOT, 'mgmt', 'config', 'freebie.config.json');

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStorePrefix(store) {
  const raw = String(store || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('LG')) return raw.slice(2);
  return raw;
}

function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(stripBom(raw));
  } catch {
    return fallback;
  }
}

function getLatestDateDirName(entries) {
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))[0];
}

function getItemCount(row) {
  const platformItems = Array.isArray(row?.platformSkuList) ? row.platformSkuList : [];
  if (platformItems.length > 0) {
    return platformItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0);
  }
  const skuItems = Array.isArray(row?.skuList) ? row.skuList : [];
  if (skuItems.length > 0) {
    return skuItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0);
  }
  return 0;
}

function getSpendUsd(row) {
  const subTotal = toNumber(row?.sub_total, NaN);
  if (Number.isFinite(subTotal)) return subTotal;
  const totalAmount = toNumber(row?.total_amount, NaN);
  if (Number.isFinite(totalAmount)) return totalAmount;
  const originalTotal = toNumber(row?.original_total_product_price, NaN);
  if (Number.isFinite(originalTotal)) return originalTotal;
  return 0;
}

function chooseGiftSku(targetSku, existingGiftBag) {
  const candidates = Array.isArray(targetSku) ? targetSku.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!candidates.length) return '';
  if (existingGiftBag && candidates.includes(existingGiftBag)) return existingGiftBag;
  if (candidates.length === 1) return candidates[0];
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

function selectPolicyForRow(row, policies) {
  const itemCount = getItemCount(row);
  const spendUsd = getSpendUsd(row);
  for (const policy of policies) {
    const minItems = Number(policy?.minItems || 0);
    const minSpendUsd = Number(policy?.minSpendUsd || 0);
    const byItems = minItems > 0 && itemCount >= minItems;
    const bySpend = minSpendUsd > 0 && spendUsd >= minSpendUsd;
    if (byItems || bySpend) return { policy, itemCount, spendUsd };
  }
  return { policy: null, itemCount, spendUsd };
}

async function resolveTargetFiles(orderRoot, dateArg, storePrefix) {
  const entries = await fs.readdir(orderRoot, { withFileTypes: true });
  const dateDirName = String(dateArg || '').trim() || getLatestDateDirName(entries);
  if (!dateDirName) throw new Error(`No YYMMDD order directory found under ${orderRoot}`);
  const dateDir = path.join(orderRoot, dateDirName);
  const files = await fs.readdir(dateDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .filter((name) => /^\d+\.json$/i.test(name))
    .filter((name) => !storePrefix || path.basename(name, '.json') === storePrefix)
    .map((name) => path.join(dateDir, name));
}

async function applyPolicyToFile(filePath, policies) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseJsonSafe(raw, {});
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  let updatedRows = 0;
  let assignedRows = 0;
  let clearedRows = 0;

  for (const row of rows) {
    const { policy } = selectPolicyForRow(row, policies);
    const prevBag = String(row?.giftBag || '').trim();
    const prevPolicy = String(row?.giftBagPolicyKey || '').trim();

    if (!policy) {
      let changed = false;
      if (row.giftBag !== undefined) {
        delete row.giftBag;
        changed = true;
      }
      if (row.giftBagPolicyKey !== undefined) {
        delete row.giftBagPolicyKey;
        changed = true;
      }
      if (row.giftBagPolicyDescription !== undefined) {
        delete row.giftBagPolicyDescription;
        changed = true;
      }
      if (changed) {
        updatedRows += 1;
        clearedRows += 1;
      }
      continue;
    }

    const nextBag = chooseGiftSku(policy.targetSku, prevBag);
    if (!nextBag) continue;
    const nextPolicy = String(policy.key || '').trim();
    const nextDesc = String(policy.description || '').trim();

    if (prevBag !== nextBag || prevPolicy !== nextPolicy || String(row?.giftBagPolicyDescription || '') !== nextDesc) {
      row.giftBag = nextBag;
      row.giftBagPolicyKey = nextPolicy;
      row.giftBagPolicyDescription = nextDesc;
      updatedRows += 1;
    }
    assignedRows += 1;
  }

  if (updatedRows > 0) {
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  }
  return { filePath, totalRows: rows.length, assignedRows, clearedRows, updatedRows };
}

async function main() {
  const orderRoot = readArg('orderRoot', DEFAULT_ORDER_ROOT);
  const configPath = readArg('config', DEFAULT_CONFIG_PATH);
  const dateArg = readArg('date', '');
  const storePrefix = normalizeStorePrefix(readArg('store', readArg('shopRoomCode', '')));

  const configRaw = await fs.readFile(configPath, 'utf8');
  const config = parseJsonSafe(configRaw, {});
  const policies = Array.isArray(config?.policies) ? config.policies : [];
  if (!policies.length) throw new Error(`No policies found in ${configPath}`);

  const targets = await resolveTargetFiles(orderRoot, dateArg, storePrefix);
  if (!targets.length) throw new Error('No matching order files found for requested scope');

  const summary = [];
  for (const filePath of targets) {
    summary.push(await applyPolicyToFile(filePath, policies));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        configPath,
        orderRoot,
        fileCount: summary.length,
        files: summary
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

