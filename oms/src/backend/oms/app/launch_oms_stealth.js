const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const net = require('net');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const DEFAULT_OMS_LOGIN_URL = 'https://oms.xlwms.com/login';
const DEFAULT_OMS_ORDERS_URL = 'https://oms.xlwms.com/';
const DEFAULT_OMS_COOKIES_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'mgmt',
  'config',
  'oms.cookies.json'
);
const DEFAULT_OMS_STORAGE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'mgmt',
  'config',
  'oms.cookies.storage.json'
);
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;
const DEFAULT_LAUNCH_PAGE_SIZE = 2000;
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_PROJECT_CONFIG_PATH = path.resolve(
  WORKSPACE_ROOT,
  'mgmt',
  'config',
  'oms.config.json'
);

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadProjectConfig(configPath) {
  const localPath =
    process.env.OMS_CONFIG_LOCAL_PATH || path.resolve(path.dirname(configPath), 'oms.config.local.json');

  const readConfig = async (targetPath, label) => {
    if (!(await fileExists(targetPath))) return { loaded: false, data: {} };
    try {
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(stripBom(raw));
      return { loaded: true, data: parsed && typeof parsed === 'object' ? parsed : {} };
    } catch (error) {
      console.warn(`Failed to load OMS ${label} config from ${targetPath}: ${error.message}`);
      return { loaded: false, data: {} };
    }
  };

  const mergeDeep = (baseValue, overrideValue) => {
    if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
      return Array.isArray(overrideValue) ? overrideValue : Array.isArray(baseValue) ? baseValue : [];
    }
    if (
      baseValue &&
      typeof baseValue === 'object' &&
      overrideValue &&
      typeof overrideValue === 'object'
    ) {
      const out = { ...baseValue };
      for (const [key, value] of Object.entries(overrideValue)) {
        out[key] = mergeDeep(baseValue[key], value);
      }
      return out;
    }
    return overrideValue !== undefined ? overrideValue : baseValue;
  };

  const baseCfg = await readConfig(configPath, 'base');
  const localCfg = await readConfig(localPath, 'local');
  const merged = mergeDeep(baseCfg.data, localCfg.data);
  return {
    loaded: baseCfg.loaded || localCfg.loaded,
    path: configPath,
    localPath,
    localLoaded: localCfg.loaded,
    data: merged && typeof merged === 'object' ? merged : {}
  };
}

function resolvePathValue(pathValue, { fallbackPath, configPath }) {
  const candidate = String(pathValue || '').trim();
  if (!candidate) return fallbackPath;
  if (path.isAbsolute(candidate)) return candidate;
  if (candidate.startsWith('./') || candidate.startsWith('.\\') || candidate.startsWith('..')) {
    return path.resolve(path.dirname(configPath), candidate);
  }
  return path.resolve(WORKSPACE_ROOT, candidate);
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

async function attemptLogin(page, username, password) {
  if (!username || !password) {
    return { attempted: false, success: false, reason: 'credentials_missing' };
  }

  const filled = await page.evaluate(
    ({ user, pass }) => {
      const textInputs = Array.from(document.querySelectorAll('input'));
      const userInput =
        textInputs.find((el) => /user|account|login|email|phone/i.test(String(el.name || ''))) ||
        textInputs.find((el) => /user|account|login|email|phone/i.test(String(el.placeholder || ''))) ||
        textInputs.find((el) => (el.type || '').toLowerCase() === 'text');
      const passInput =
        textInputs.find((el) => (el.type || '').toLowerCase() === 'password') ||
        textInputs.find((el) => /password|pwd|pass/i.test(String(el.name || ''))) ||
        textInputs.find((el) => /password|pwd|pass/i.test(String(el.placeholder || '')));

      if (!userInput || !passInput) {
        return { ok: false, reason: 'inputs_not_found' };
      }

      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      setValue(userInput, user);
      setValue(passInput, pass);

      const submitBtn =
        document.querySelector('button[type="submit"]') ||
        Array.from(document.querySelectorAll('button, .el-button')).find((el) =>
          /login|sign in|log in|\u767b\u5f55/i.test((el.textContent || '').trim())
        );
      if (!submitBtn) {
        return { ok: true, reason: 'submitted_manual_required' };
      }
      submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      submitBtn.click();
      return { ok: true, reason: 'submitted' };
    },
    { user: String(username), pass: String(password) }
  );

  if (!filled.ok) {
    return { attempted: true, success: false, reason: filled.reason };
  }

  try {
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }),
      page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 15_000 })
    ]);
  } catch {
    // Best-effort; allow manual completion if login takes longer or needs challenge handling.
  }
  const landedUrl = page.url();
  return { attempted: true, success: !landedUrl.includes('/login'), reason: filled.reason, landedUrl };
}

async function main() {
  const configPathRaw = process.env.OMS_CONFIG_PATH || DEFAULT_PROJECT_CONFIG_PATH;
  const configPath = path.isAbsolute(configPathRaw) ? configPathRaw : path.resolve(process.cwd(), configPathRaw);
  const projectConfigLoad = await loadProjectConfig(configPath);
  const omsConfig = projectConfigLoad.data && typeof projectConfigLoad.data.oms === 'object' ? projectConfigLoad.data.oms : {};
  const launchConfig = omsConfig.launch && typeof omsConfig.launch === 'object' ? omsConfig.launch : {};
  const credentials = omsConfig.credentials && typeof omsConfig.credentials === 'object' ? omsConfig.credentials : {};

  const loginUrl = process.env.OMS_LOGIN_URL || omsConfig.loginUrl || DEFAULT_OMS_LOGIN_URL;
  const ordersUrl = process.env.OMS_ORDERS_URL || omsConfig.ordersUrl || DEFAULT_OMS_ORDERS_URL;
  const cookiesPath = resolvePathValue(process.env.OMS_COOKIES_PATH || omsConfig.cookiesPath, {
    fallbackPath: DEFAULT_OMS_COOKIES_PATH,
    configPath
  });
  const storagePath = resolvePathValue(process.env.OMS_STORAGE_PATH || omsConfig.storagePath, {
    fallbackPath: DEFAULT_OMS_STORAGE_PATH,
    configPath
  });
  const omsUsername = process.env.OMS_USERNAME || credentials.username || '';
  const omsPassword = process.env.OMS_PASSWORD || credentials.password || '';

  const hiddenMode = process.env.OMS_HIDDEN != null ? isTruthy(process.env.OMS_HIDDEN) : isTruthy(launchConfig.hidden);
  const windowWidth = Number(process.env.OMS_WINDOW_WIDTH || launchConfig.windowWidth || DEFAULT_WINDOW_WIDTH);
  const windowHeight = Number(process.env.OMS_WINDOW_HEIGHT || launchConfig.windowHeight || DEFAULT_WINDOW_HEIGHT);
  const launchSetPageSize = !/^(0|false|no|off)$/i.test(
    String(process.env.OMS_SET_PAGE_SIZE_ON_LAUNCH ?? launchConfig.setPageSizeOnLaunch ?? '1').trim()
  );
  const launchPageSize = Number(process.env.OMS_LAUNCH_PAGE_SIZE || launchConfig.launchPageSize || DEFAULT_LAUNCH_PAGE_SIZE);
  const requestedDebugPort = Number(process.env.DEBUG_PORT || launchConfig.debugPort || 9222);
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
  let landedUrl = page.url();
  let onLoginPage = landedUrl.includes('/login');
  let loginAttemptStatus = 'skipped';
  if (onLoginPage && omsUsername && omsPassword) {
    const loginAttempt = await attemptLogin(page, omsUsername, omsPassword);
    loginAttemptStatus = loginAttempt.success ? 'ok' : `warning (${loginAttempt.reason})`;
    landedUrl = loginAttempt.landedUrl || page.url();
    onLoginPage = landedUrl.includes('/login');
  } else if (onLoginPage) {
    loginAttemptStatus = 'skipped (credentials missing)';
  }
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
  console.log(`Config path: ${configPath}`);
  if (projectConfigLoad.localLoaded) {
    console.log(`Local config override: ${projectConfigLoad.localPath}`);
  }
  console.log(`Config loaded: ${projectConfigLoad.loaded ? 'yes' : 'no'}`);
  console.log(`Cookies path: ${cookiesPath}`);
  console.log(`Storage path: ${storagePath}`);
  console.log(`Cookies preloaded: ${usedCookies ? 'yes' : 'no'}`);
  console.log(`Storage preloaded: ${usedStorage ? 'yes' : 'no'}`);
  console.log(`Login credentials configured: ${omsUsername && omsPassword ? 'yes' : 'no'}`);
  console.log(`Login autofill result: ${loginAttemptStatus}`);
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
