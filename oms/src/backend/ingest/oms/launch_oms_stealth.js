const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const net = require('net');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const DEFAULT_OMS_LOGIN_URL = 'https://oms.xlwms.com/login';
const DEFAULT_OMS_ORDERS_URL = 'https://oms.xlwms.com/platform/order/list';
const DEFAULT_OMS_COOKIES_PATH = 'C:\\orderBot\\mgmt\\data\\oms\\cookies.json';
const DEFAULT_OMS_STORAGE_PATH = 'C:\\orderBot\\mgmt\\data\\oms\\cookies.storage.json';
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;
const DEFAULT_LAUNCH_PAGE_SIZE = 2000;

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBrowserLaunchConfig() {
  const envExecutable =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.BROWSER_PATH;
  if (envExecutable) {
    if (!(await fileExists(envExecutable))) {
      throw new Error(
        `Browser executable from environment was not found: ${envExecutable}. ` +
          'Update CHROME_PATH/PUPPETEER_EXECUTABLE_PATH/BROWSER_PATH.'
      );
    }
    return { executablePath: envExecutable };
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const candidates = [
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return { executablePath: candidate };
      }
    }
  }

  return { channel: process.env.BROWSER_CHANNEL || 'chrome' };
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickDebugPort(preferredPort) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available debug port found from ${preferredPort} to ${preferredPort + 19}`);
}

function sanitizeCookies(cookies) {
  const allowedKeys = new Set([
    'name',
    'value',
    'domain',
    'path',
    'expires',
    'httpOnly',
    'secure',
    'sameSite',
    'url'
  ]);
  return (cookies || []).map((cookie) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(cookie || {})) {
      if (allowedKeys.has(key)) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  });
}

async function loadCookies(page, cookiesPath) {
  if (!(await fileExists(cookiesPath))) return false;
  try {
    const raw = await fs.readFile(cookiesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      await page.setCookie(...sanitizeCookies(parsed));
      return true;
    }
  } catch (error) {
    console.warn(`Failed to load OMS cookies from ${cookiesPath}: ${error.message}`);
  }
  return false;
}

async function loadStorageState(page, storagePath, ordersUrl) {
  if (!(await fileExists(storagePath))) return false;
  try {
    const raw = await fs.readFile(storagePath, 'utf8');
    const snapshot = JSON.parse(raw);
    const fallbackOrigin = safeOrigin(ordersUrl);
    const targetOrigin = snapshot.origin || fallbackOrigin;
    const localEntries = Object.entries(snapshot.localStorage || {});
    const sessionEntries = Object.entries(snapshot.sessionStorage || {});
    if (!targetOrigin) return false;

    await page.evaluateOnNewDocument(
      (state) => {
        try {
          if (window.location.origin !== state.targetOrigin) return;
          for (const [key, value] of state.localEntries) {
            window.localStorage.setItem(key, value);
          }
          for (const [key, value] of state.sessionEntries) {
            window.sessionStorage.setItem(key, value);
          }
        } catch {
          // Ignore browser storage restore failures.
        }
      },
      { targetOrigin, localEntries, sessionEntries }
    );
    return true;
  } catch (error) {
    console.warn(`Failed to load OMS storage from ${storagePath}: ${error.message}`);
    return false;
  }
}

function safeOrigin(urlValue) {
  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

async function clickByBoundingBox(page, selector) {
  const handle = await page.$(selector);
  if (!handle) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      el.click();
      return true;
    }, selector).catch(() => false);
  }
  const box = await handle.boundingBox();
  if (!box || box.width < 2 || box.height < 2) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      el.click();
      return true;
    }, selector).catch(() => false);
  }
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

  let openedDropdown = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const opened = await clickByBoundingBox(page, 'span.el-pagination__sizes .el-input__inner');
    if (!opened) {
      throw new Error('Failed to click pagination size trigger.');
    }
    await page.evaluate(() => {
      const el = document.querySelector('span.el-pagination__sizes .el-input__inner');
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      el.click();
    }).catch(() => {});
    try {
      await page.waitForFunction(() => {
        const nodes = Array.from(document.querySelectorAll('div.el-select-dropdown.el-popper'));
        return nodes.some((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 10 && r.height > 10;
        });
      }, { timeout: 4_000 });
      openedDropdown = true;
      break;
    } catch {
      await page.keyboard.press('Escape').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!openedDropdown) {
    throw new Error('Failed to open page-size dropdown.');
  }

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
    return { ok: true };
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

async function main() {
  const loginUrl = process.env.OMS_LOGIN_URL || DEFAULT_OMS_LOGIN_URL;
  const ordersUrl = process.env.OMS_ORDERS_URL || DEFAULT_OMS_ORDERS_URL;
  const cookiesPath = process.env.OMS_COOKIES_PATH || DEFAULT_OMS_COOKIES_PATH;
  const storagePath = process.env.OMS_STORAGE_PATH || DEFAULT_OMS_STORAGE_PATH;

  const hiddenMode = isTruthy(process.env.OMS_HIDDEN);
  const windowWidth = Number(process.env.OMS_WINDOW_WIDTH || DEFAULT_WINDOW_WIDTH);
  const windowHeight = Number(process.env.OMS_WINDOW_HEIGHT || DEFAULT_WINDOW_HEIGHT);
  const launchSetPageSize = !/^(0|false|no|off)$/i.test(String(process.env.OMS_SET_PAGE_SIZE_ON_LAUNCH || '1').trim());
  const launchPageSize = Number(process.env.OMS_LAUNCH_PAGE_SIZE || DEFAULT_LAUNCH_PAGE_SIZE);
  const requestedDebugPort = Number(process.env.DEBUG_PORT || 9222);
  const debugPort = await pickDebugPort(requestedDebugPort);
  const browserLaunchConfig = await resolveBrowserLaunchConfig();

  const userDataDir = path.join(os.tmpdir(), `oms-stealth-${Date.now().toString(36)}`);
  const launchArgs = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=CalculateNativeWinOcclusion',
    '--ignore-certificate-errors',
    `--window-size=${windowWidth},${windowHeight}`
  ];
  if (!hiddenMode) {
    launchArgs.push('--start-maximized');
  }

  const browser = await puppeteer.launch({
    headless: hiddenMode ? 'new' : false,
    defaultViewport: hiddenMode ? { width: windowWidth, height: windowHeight } : null,
    protocolTimeout: 120000,
    userDataDir,
    ...browserLaunchConfig,
    args: launchArgs
  });

  const cleanup = async () => {
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup for temporary profile directory.
    }
  };

  browser.on('disconnected', async () => {
    await cleanup();
    process.exit(0);
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  for (const extra of pages.slice(1)) {
    try {
      await extra.close({ runBeforeUnload: false });
    } catch {
      // Ignore tab-close races.
    }
  }

  const usedCookies = await loadCookies(page, cookiesPath);
  const usedStorage = await loadStorageState(page, storagePath, ordersUrl);

  await page.goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const landedUrl = page.url();
  const onLoginPage = landedUrl.includes('/login');
  let launchPageSizeStatus = 'skipped';
  if (!onLoginPage && launchSetPageSize) {
    try {
      const res = await ensurePageSize(page, launchPageSize);
      launchPageSizeStatus = `ok (changed=${res.changed ? 1 : 0}, current=${res.current})`;
    } catch (error) {
      launchPageSizeStatus = `warning (${error.message || error})`;
    }
  } else if (onLoginPage) {
    launchPageSizeStatus = 'skipped (login page)';
  } else {
    launchPageSizeStatus = 'disabled by OMS_SET_PAGE_SIZE_ON_LAUNCH';
  }

  console.log('OMS launched in stealth mode. Keep this terminal open.');
  console.log(`DevTools remote debugging: http://127.0.0.1:${debugPort}`);
  console.log(`Profile mode: temporary (${userDataDir})`);
  console.log(`GUI visibility: ${hiddenMode ? 'hidden (headless)' : 'visible'}`);
  console.log(`OMS login URL: ${loginUrl}`);
  console.log(`OMS orders URL: ${ordersUrl}`);
  console.log(`Current page URL: ${landedUrl}`);
  console.log(`Cookies path: ${cookiesPath}`);
  console.log(`Storage path: ${storagePath}`);
  console.log(`Cookies preloaded: ${usedCookies ? 'yes' : 'no'}`);
  console.log(`Storage preloaded: ${usedStorage ? 'yes' : 'no'}`);
  console.log(`Session state: ${onLoginPage ? 'not logged in (login page)' : 'likely logged in'}`);
  console.log(`Launch page size target: ${launchPageSize}`);
  console.log(`Launch page size result: ${launchPageSizeStatus}`);
  console.log('Close the browser window to end the session.');

  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Failed to launch OMS stealth session:', error);
  process.exit(1);
});
