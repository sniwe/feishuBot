const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'mgmt', 'config', 'oms.config.json');
const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, '..', '..', 'data', 'orders');
const DEFAULT_LOGIN_URL = 'https://oms.xlwms.com/login';
const DEFAULT_ORDERS_URL = 'https://oms.xlwms.com/platform/order/list';
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function yyMMdd(date) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function sanitizeFilePart(value) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return cleaned || 'UNK';
}

function col13Prefix(row) {
  const raw = String(row?.cols?.col_13 || '').trim();
  const first3 = Array.from(raw).slice(0, 3).join('');
  return sanitizeFilePart(first3 || 'UNK');
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
  const credentials = parsed?.oms?.credentials || {};
  return {
    configPath,
    debugPort: Number(process.env.CDP_PORT || process.env.DEBUG_PORT || launch.debugPort || 9222),
    loginUrl: String(process.env.OMS_LOGIN_URL || parsed?.oms?.loginUrl || DEFAULT_LOGIN_URL),
    ordersUrl: String(process.env.OMS_ORDERS_URL || parsed?.oms?.ordersUrl || DEFAULT_ORDERS_URL),
    username: String(process.env.OMS_USERNAME || credentials.username || ''),
    password: String(process.env.OMS_PASSWORD || credentials.password || ''),
    cookiesPath: String(process.env.OMS_COOKIES_PATH || parsed?.oms?.cookiesPath || ''),
    storagePath: String(process.env.OMS_STORAGE_PATH || parsed?.oms?.storagePath || '')
  };
}

async function connectFast(primaryPort) {
  const ports = Array.from({ length: 20 }, (_, index) => primaryPort + index);
  let lastError = null;
  for (const port of ports) {
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
        protocolTimeout: 12000
      });
      return { browser, port };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Fast-path connect failed on ports ${ports.join(', ')}: ${lastError?.message || lastError}`);
}

function launchOmsIfNeeded(primaryPort) {
  const env = {
    ...process.env,
    DEBUG_PORT: String(primaryPort),
    OMS_HIDDEN: '1'
  };
  const spawnSpec =
    process.platform === 'win32'
      ? {
          cmd: process.env.ComSpec || 'cmd.exe',
          args: ['/d', '/s', '/c', 'npm.cmd run launch:oms:hidden']
        }
      : {
          cmd: 'npm',
          args: ['run', 'launch:oms:hidden']
        };
  const child = spawn(spawnSpec.cmd, spawnSpec.args, {
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: 'ignore',
    env
  });
  child.unref();
  return child.pid || null;
}

async function connectWithAutoLaunch(primaryPort) {
  try {
    return { ...(await connectFast(primaryPort)), launchedPid: null, autoLaunched: false };
  } catch (firstError) {
    const launchedPid = launchOmsIfNeeded(primaryPort);
    const startedAt = Date.now();
    const timeoutMs = 90000;
    let lastError = firstError;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        const conn = await connectFast(primaryPort);
        return { ...conn, launchedPid, autoLaunched: true };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Auto-launch started (pid=${launchedPid || 'unknown'}) but CDP was not reachable in ${timeoutMs}ms: ${lastError?.message || lastError}`
    );
  }
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

async function detectLoginPage(page) {
  if ((page.url() || '').includes('/login')) return true;
  const hasLoginInputs = await page
    .evaluate(() => {
      const user = document.querySelector('input[placeholder="请输入账号名"], input[name="username"]');
      const pass = document.querySelector('input[placeholder="请输入密码"], input[name="password"], input[type="password"]');
      return Boolean(user && pass);
    })
    .catch(() => false);
  return hasLoginInputs;
}

async function autoLoginIfNeeded(page, launch) {
  const loginDetected = await detectLoginPage(page);
  if (!loginDetected) return { loginDetected: false, loginPerformed: false, loginSucceeded: true };

  if (!launch.username || !launch.password) {
    return { loginDetected: true, loginPerformed: false, loginSucceeded: false, reason: 'credentials_missing' };
  }

  await page.goto(launch.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  await page.waitForSelector('input[placeholder="请输入账号名"], input[name="username"]', { visible: true, timeout: 20000 });
  await page.waitForSelector('input[placeholder="请输入密码"], input[name="password"], input[type="password"]', {
    visible: true,
    timeout: 20000
  });

  const userSel = 'input[placeholder="请输入账号名"], input[name="username"]';
  const passSel = 'input[placeholder="请输入密码"], input[name="password"], input[type="password"]';
  await page.click(userSel, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(userSel, launch.username, { delay: 20 });
  await page.click(passSel, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(passSel, launch.password, { delay: 20 });

  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, .el-button, [role="button"]')).find((el) =>
      /(^|\s)登录(\s|$)/.test(String(el.textContent || '').trim())
    );
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    btn.click();
    return true;
  });
  if (!clicked) {
    return { loginDetected: true, loginPerformed: true, loginSucceeded: false, reason: 'login_button_missing' };
  }

  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
    page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 45000 }).catch(() => null)
  ]);

  const stillLogin = await detectLoginPage(page);
  return {
    loginDetected: true,
    loginPerformed: true,
    loginSucceeded: !stillLogin,
    reason: stillLogin ? 'still_on_login' : 'ok'
  };
}

async function persistSessionArtifacts(page, launch) {
  const out = { cookiesSaved: false, storageSaved: false, cookiesPath: launch.cookiesPath, storagePath: launch.storagePath };

  if (launch.cookiesPath) {
    const cookies = await page.cookies('https://oms.xlwms.com', launch.ordersUrl).catch(() => page.cookies());
    await fs.mkdir(path.dirname(launch.cookiesPath), { recursive: true });
    await fs.writeFile(launch.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
    out.cookiesSaved = true;
  }

  if (launch.storagePath) {
    const state = await page.evaluate(() => {
      const localStorageState = {};
      const sessionStorageState = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key != null) localStorageState[key] = window.localStorage.getItem(key);
      }
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (key != null) sessionStorageState[key] = window.sessionStorage.getItem(key);
      }
      return { origin: window.location.origin, localStorage: localStorageState, sessionStorage: sessionStorageState };
    });
    await fs.mkdir(path.dirname(launch.storagePath), { recursive: true });
    await fs.writeFile(launch.storagePath, JSON.stringify(state, null, 2), 'utf8');
    out.storageSaved = true;
  }
  return out;
}

async function clickMainTabFast(page) {
  await page.waitForSelector('div#tab--1', { visible: true, timeout: 5000 });
  await page.click('div#tab--1');
}

async function waitTableStabilityFast(page) {
  const samples = [];
  let prev = null;
  let stable = 0;
  let maxSeen = 0;
  for (let i = 0; i < 28; i += 1) {
    const count = await page.evaluate(() => {
      const xidNodes = Array.from(document.querySelectorAll('[xid="1"]'));
      const ranked = xidNodes
        .map((n) => ({
          col21Count: n.querySelectorAll('[colid="col_21"]').length,
          trCount: n.querySelectorAll('tr').length
        }))
        .sort((a, b) => b.col21Count - a.col21Count || b.trCount - a.trCount);
      return ranked.length ? ranked[0].col21Count : 0;
    });
    samples.push(count);
    if (count > maxSeen) maxSeen = count;
    if (prev !== null && count === prev) stable += 1;
    else stable = 0;
    prev = count;
    const enoughRows = count >= 10;
    if (enoughRows && stable >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  return { samples, stableReached: stable >= 2 && (prev || 0) >= 10, finalCount: prev || 0, maxSeen };
}

async function scanAllRowsFast(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pickBestNode = () => {
      const xidNodes = Array.from(document.querySelectorAll('[xid="1"]'));
      const ranked = xidNodes
        .map((n) => ({
          node: n,
          col21Count: n.querySelectorAll('[colid="col_21"]').length,
          trCount: n.querySelectorAll('tr').length
        }))
        .sort((a, b) => b.col21Count - a.col21Count || b.trCount - a.trCount);
      return ranked.length ? ranked[0].node : null;
    };

    const rowMap = new Map();
    let bottomStable = 0;

    for (let i = 0; i < 110; i += 1) {
      const table = pickBestNode();
      if (!table) return { ok: false, reason: 'table_xid_1_not_found', rows: [] };

      const bodyWrapper =
        table.querySelector('.vxe-table--body-wrapper') ||
        table.querySelector('.el-table__body-wrapper') ||
        table.closest('.vxe-table')?.querySelector('.vxe-table--body-wrapper') ||
        table;

      const rows = Array.from(table.querySelectorAll('tr'))
        .map((row, idx) => {
          const cols = {};
          for (const cell of Array.from(row.querySelectorAll('[colid]'))) {
            const cid = cell.getAttribute('colid');
            if (!cid) continue;
            cols[cid] = String(cell.textContent || '').replace(/\s+/g, ' ').trim();
          }
          return {
            rowIndex: idx,
            rowId: row.getAttribute('rowid') || row.getAttribute('data-rowid') || null,
            col21: String(cols.col_21 || '').trim(),
            cols
          };
        })
        .filter((r) => r.col21 || Object.keys(r.cols).length > 0);

      for (const row of rows) {
        const key = row.rowId || `${row.cols.col_21 || ''}|${row.cols.col_1 || ''}|${row.cols.col_2 || ''}|${row.rowIndex}`;
        if (!rowMap.has(key)) rowMap.set(key, row);
      }

      const scrollTop = Number(bodyWrapper.scrollTop || 0);
      const scrollHeight = Number(bodyWrapper.scrollHeight || 0);
      const clientHeight = Number(bodyWrapper.clientHeight || 0);
      const atBottom = scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - 4;
      if (atBottom) {
        bottomStable += 1;
        if (bottomStable >= 2) break;
      } else {
        bottomStable = 0;
      }

      const step = Math.max(180, Math.floor((clientHeight || 300) * 0.95));
      bodyWrapper.scrollTop = scrollTop + step;
      await sleep(20);
    }

    return { ok: true, reason: 'ok', rows: Array.from(rowMap.values()) };
  });
}

async function writeGroupedOutput(outputRoot, grouped, metadata) {
  const written = [];
  const entries = Object.entries(grouped);
  if (entries.length === 0) {
    const fallbackKey = yyMMdd(new Date());
    const dir = path.join(outputRoot, fallbackKey);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, 'NO_MATCH.json');
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          ...metadata,
          orderDate: fallbackKey,
          col13Prefix: 'NO_MATCH',
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
    const byPrefix = {};
    for (const row of rows) {
      const prefix = col13Prefix(row);
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(row);
    }
    for (const [prefix, prefRows] of Object.entries(byPrefix)) {
      const outPath = path.join(dir, `${prefix}.json`);
      await fs.writeFile(
        outPath,
        JSON.stringify(
          {
            ...metadata,
            orderDate: dateKey,
            col13Prefix: prefix,
            matchedCount: prefRows.length,
            rows: prefRows
          },
          null,
          2
        ),
        'utf8'
      );
      written.push(outPath);
    }
  }
  return written;
}

async function main() {
  const configPath = process.env.OMS_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  const outputRoot = process.env.OMS_COL21_SCAN_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT;
  const now = new Date();
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const launch = await loadLaunchConfig(configPath);
  const conn = await connectWithAutoLaunch(launch.debugPort);
  try {
    const page = await resolveOrdersPage(conn.browser, launch.ordersUrl);
    const login = await autoLoginIfNeeded(page, launch);
    if (login.loginDetected && !login.loginSucceeded) {
      throw new Error(`Auto-login failed: ${login.reason || 'unknown'}`);
    }
    if ((page.url() || '').includes('/login')) {
      await page.goto(launch.ordersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    const sessionSaved = await persistSessionArtifacts(page, launch);
    await clickMainTabFast(page);
    const stable = await waitTableStabilityFast(page);
    const scan = await scanAllRowsFast(page);
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
        mode: 'fast-flow-last2h',
        cdpPort: conn.port,
        configPath: launch.configPath,
        url: page.url(),
        scannedAt: new Date().toISOString(),
        window: {
          from: toIsoLocal(cutoff),
          to: toIsoLocal(now)
        },
        stabilized: stable,
        scannedRowCount: scan.rows.length
      }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'fast-flow-last2h',
          cdpPort: conn.port,
          autoLaunched: conn.autoLaunched,
          launchedPid: conn.launchedPid,
          login,
          sessionSaved,
          configPath: launch.configPath,
          url: page.url(),
          stabilized: stable,
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
