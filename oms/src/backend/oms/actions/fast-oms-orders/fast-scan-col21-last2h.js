const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'mgmt', 'config', 'oms.config.json');
const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, '..', '..', 'data', 'orders');
const DEFAULT_ORDERS_URL = 'https://oms.xlwms.com/platform/order/list';

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function yyMMdd(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function toIsoLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function parseCol21Time(raw, now) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const normalized = text.replace(/[年/]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '').replace(/\s+/g, ' ').trim();

  let m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const dt = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  m = normalized.match(/^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const dt = new Date(
      now.getFullYear(),
      Number(m[1]) - 1,
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5] || 0)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  m = normalized.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const dt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3] || 0)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

async function loadLaunchConfig(configPath) {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(stripBom(raw));
  const launch = parsed?.oms?.launch || {};
  return {
    configPath,
    debugPort: Number(process.env.CDP_PORT || process.env.DEBUG_PORT || launch.debugPort || 9222),
    ordersUrl: String(process.env.OMS_ORDERS_URL || parsed?.oms?.ordersUrl || DEFAULT_ORDERS_URL)
  };
}

async function connectFast(primaryPort) {
  const ports = [primaryPort, primaryPort + 1, primaryPort + 2];
  let lastError = null;
  for (const port of ports) {
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
        protocolTimeout: 15000
      });
      return { browser, port };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Fast-path connect failed on ports ${ports.join(', ')}: ${lastError?.message || lastError}`);
}

async function resolveOrdersPage(browser, ordersUrl) {
  const pages = await browser.pages();
  const page =
    pages.find((p) => (p.url() || '').includes('/platform/order/list')) ||
    pages.find((p) => (p.url() || '').includes('oms.xlwms.com')) ||
    pages[0] ||
    (await browser.newPage());
  await page.bringToFront();
  if (!(page.url() || '').includes('/platform/order/list')) {
    await page.goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  return page;
}

async function scanTableRows(page) {
  const rowMap = new Map();

  const snapVisible = async () =>
    page.evaluate(() => {
      const xidNodes = Array.from(document.querySelectorAll('[xid="1"]'));
      const ranked = xidNodes
        .map((n) => ({
          node: n,
          col21Count: n.querySelectorAll('[colid="col_21"]').length,
          trCount: n.querySelectorAll('tr').length
        }))
        .sort((a, b) => b.col21Count - a.col21Count || b.trCount - a.trCount);
      const table = ranked.length ? ranked[0].node : null;
      if (!table || ranked[0].col21Count === 0) {
        return { ok: false, reason: 'table_xid_1_not_found', rows: [], scroll: null };
      }
      const bodyWrapper =
        table.querySelector('.vxe-table--body-wrapper') ||
        table.querySelector('.el-table__body-wrapper') ||
        table.closest('.vxe-table')?.querySelector('.vxe-table--body-wrapper') ||
        table;

      const rowNodes = Array.from(table.querySelectorAll('tr'));
      const rows = rowNodes
        .map((row, idx) => {
          const col21Node = row.querySelector('[colid="col_21"]');
          const col21Text = col21Node ? String(col21Node.textContent || '').replace(/\s+/g, ' ').trim() : '';
          const cols = {};
          for (const cell of Array.from(row.querySelectorAll('[colid]'))) {
            const cid = cell.getAttribute('colid');
            if (!cid) continue;
            cols[cid] = String(cell.textContent || '').replace(/\s+/g, ' ').trim();
          }
          const hasAnyCol = Object.keys(cols).length > 0;
          return {
            rowIndex: idx,
            rowId: row.getAttribute('rowid') || row.getAttribute('data-rowid') || null,
            col21: col21Text,
            cols,
            hasAnyCol
          };
        })
        .filter((r) => r.hasAnyCol || r.col21);

      const scrollTop = bodyWrapper ? Number(bodyWrapper.scrollTop || 0) : 0;
      const scrollHeight = bodyWrapper ? Number(bodyWrapper.scrollHeight || 0) : 0;
      const clientHeight = bodyWrapper ? Number(bodyWrapper.clientHeight || 0) : 0;
      return { ok: true, reason: 'ok', rows, scroll: { scrollTop, scrollHeight, clientHeight } };
    });

  const scrollStep = async () =>
    page.evaluate(() => {
      const xidNodes = Array.from(document.querySelectorAll('[xid="1"]'));
      const ranked = xidNodes
        .map((n) => ({
          node: n,
          col21Count: n.querySelectorAll('[colid="col_21"]').length,
          trCount: n.querySelectorAll('tr').length
        }))
        .sort((a, b) => b.col21Count - a.col21Count || b.trCount - a.trCount);
      const table = ranked.length ? ranked[0].node : null;
      if (!table || ranked[0].col21Count === 0) return { ok: false };
      const bodyWrapper =
        table.querySelector('.vxe-table--body-wrapper') ||
        table.querySelector('.el-table__body-wrapper') ||
        table.closest('.vxe-table')?.querySelector('.vxe-table--body-wrapper');
      if (!bodyWrapper) return { ok: true, moved: false };
      const step = Math.max(200, Math.floor((bodyWrapper.clientHeight || 400) * 0.9));
      const before = Number(bodyWrapper.scrollTop || 0);
      bodyWrapper.scrollTop = before + step;
      const after = Number(bodyWrapper.scrollTop || 0);
      return { ok: true, moved: after > before, before, after };
    });

  let bottomStableCount = 0;
  for (let i = 0; i < 120; i += 1) {
    const snap = await snapVisible();
    if (!snap.ok) return snap;

    for (const row of snap.rows) {
      const key =
        row.rowId ||
        `${row.cols.col_21 || ''}|${row.cols.col_1 || ''}|${row.cols.col_2 || ''}|${row.rowIndex}`;
      if (!rowMap.has(key)) rowMap.set(key, row);
    }

    const { scrollTop, scrollHeight, clientHeight } = snap.scroll || {};
    const atBottom = scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - 4;
    if (atBottom) {
      bottomStableCount += 1;
      if (bottomStableCount >= 2) break;
    } else {
      bottomStableCount = 0;
    }

    const step = await scrollStep();
    if (!step.ok || !step.moved) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  return { ok: true, reason: 'ok', rows: Array.from(rowMap.values()) };
}

async function writeGroupedOutput(outputRoot, grouped, metadata) {
  const written = [];
  const entries = Object.entries(grouped);
  if (entries.length === 0) {
    const fallbackKey = yyMMdd(new Date());
    const dir = path.join(outputRoot, fallbackKey);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, 'xid1_col21_last2h.json');
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          ...metadata,
          orderDate: fallbackKey,
          matchedCount: 0,
          rows: []
        },
        null,
        2
      ),
      'utf8'
    );
    written.push(outPath);
    return written;
  }
  for (const [dateKey, rows] of entries) {
    const dir = path.join(outputRoot, dateKey);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, 'xid1_col21_last2h.json');
    const payload = {
      ...metadata,
      orderDate: dateKey,
      matchedCount: rows.length,
      rows
    };
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
    written.push(outPath);
  }
  return written;
}

async function main() {
  const configPath = process.env.OMS_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  const outputRoot = process.env.OMS_COL21_SCAN_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT;
  const now = new Date();
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const launch = await loadLaunchConfig(configPath);
  const conn = await connectFast(launch.debugPort);

  try {
    const page = await resolveOrdersPage(conn.browser, launch.ordersUrl);
    const scan = await scanTableRows(page);
    if (!scan.ok) throw new Error(scan.reason);

    const matched = [];
    for (const row of scan.rows) {
      const parsed = parseCol21Time(row.col21, now);
      if (!parsed) continue;
      if (parsed >= cutoff && parsed <= now) {
        matched.push({
          ...row,
          col21Parsed: toIsoLocal(parsed),
          orderDateYYMMDD: yyMMdd(parsed)
        });
      }
    }

    const grouped = {};
    for (const row of matched) {
      if (!grouped[row.orderDateYYMMDD]) grouped[row.orderDateYYMMDD] = [];
      grouped[row.orderDateYYMMDD].push(row);
    }

    const writtenFiles = await writeGroupedOutput(
      outputRoot,
      grouped,
      {
        ok: true,
        mode: 'fast-scan',
        cdpPort: conn.port,
        configPath: launch.configPath,
        url: page.url(),
        scannedAt: new Date().toISOString(),
        window: {
          from: toIsoLocal(cutoff),
          to: toIsoLocal(now)
        },
        scannedRowCount: scan.rows.length
      }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'fast-scan',
          cdpPort: conn.port,
          configPath: launch.configPath,
          url: page.url(),
          scannedRowCount: scan.rows.length,
          matchedRowCount: matched.length,
          outputRoot,
          writtenFiles
        },
        null,
        2
      )
    );
  } finally {
    await conn.browser.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
