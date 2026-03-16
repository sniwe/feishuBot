const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const DEFAULT_CONFIG_PATH = path.resolve(WORKSPACE_ROOT, 'mgmt', 'config', 'oms.config.json');
const DEFAULT_COOKIES_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'mgmt', 'config', 'oms.cookies.json');
const DEFAULT_STORAGE_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'mgmt', 'config', 'oms.cookies.storage.json');

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
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

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function loadConfig(ctx) {
  const { data = {}, deps } = ctx;
  const { fsApi } = deps;
  const requestedPath = String(data.configPath || DEFAULT_CONFIG_PATH);
  const configPath = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(process.cwd(), requestedPath);
  const raw = await fsApi.readFile(configPath, 'utf8');
  const parsed = JSON.parse(stripBom(raw));
  const username = String(parsed?.oms?.credentials?.username || '');
  const password = String(parsed?.oms?.credentials?.password || '');
  if (!username || !password) {
    throw new Error(`Missing oms.credentials.username/password in ${configPath}`);
  }
  const cookiesPath = resolvePathValue(parsed?.oms?.cookiesPath, {
    fallbackPath: DEFAULT_COOKIES_PATH,
    configPath
  });
  const storagePath = resolvePathValue(parsed?.oms?.storagePath, {
    fallbackPath: DEFAULT_STORAGE_PATH,
    configPath
  });
  return { configPath, username, password, cookiesPath, storagePath };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function findCdpPort(ctx) {
  const { data = {}, deps } = ctx;
  const { fetchApi } = deps;
  const startPort = Number(data.startPort || 9222);
  const endPort = Number(data.endPort || 9265);
  const candidates = [];

  for (let port = startPort; port <= endPort; port += 1) {
    try {
      const versionResp = await fetchApi(`http://127.0.0.1:${port}/json/version`);
      if (!versionResp.ok) continue;
      const versionJson = await versionResp.json();
      if (!versionJson?.webSocketDebuggerUrl) continue;

      const listResp = await fetchApi(`http://127.0.0.1:${port}/json/list`);
      if (!listResp.ok) {
        candidates.push({ port, hasLogin: false, hasOms: false });
        continue;
      }
      const targets = await listResp.json();
      const hasLogin = Array.isArray(targets)
        ? targets.some((t) => t && t.type === 'page' && /oms\.xlwms\.com\/login/i.test(String(t.url || '')))
        : false;
      const hasOms = Array.isArray(targets)
        ? targets.some((t) => t && t.type === 'page' && /oms\.xlwms\.com/i.test(String(t.url || '')))
        : false;
      candidates.push({ port, hasLogin, hasOms });
    } catch {
      // try next port
    }
  }

  if (!candidates.length) {
    throw new Error(`No CDP browser found on 127.0.0.1 ports ${startPort}-${endPort}`);
  }

  candidates.sort((a, b) => b.port - a.port);
  return candidates.find((c) => c.hasLogin) || candidates.find((c) => c.hasOms) || candidates[0];
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function fillAndLogin(ctx) {
  const { data = {} } = ctx;
  const {
    browser,
    username,
    password,
    loginUrl = 'https://oms.xlwms.com/login'
  } = data;

  const pages = await browser.pages();
  let page = pages.find((p) => /oms\.xlwms\.com\/login/i.test(String(p.url() || '')));
  if (!page) {
    page = pages.find((p) => /oms\.xlwms\.com/i.test(String(p.url() || ''))) || pages[0] || (await browser.newPage());
  }

  await page.bringToFront();
  if (!/oms\.xlwms\.com\/login/i.test(String(page.url() || ''))) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }

  await page.waitForSelector('input[placeholder="请输入账号名"], input[name="username"]', {
    visible: true,
    timeout: 20000
  });
  await page.waitForSelector('input[placeholder="请输入密码"], input[name="password"]', {
    visible: true,
    timeout: 20000
  });

  const userSel = 'input[placeholder="请输入账号名"], input[name="username"]';
  const passSel = 'input[placeholder="请输入密码"], input[name="password"]';

  const userEl = await page.$(userSel);
  const passEl = await page.$(passSel);
  if (!userEl || !passEl) {
    throw new Error('Could not find login inputs.');
  }

  await userEl.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(userSel, username, { delay: 35 });

  await passEl.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(passSel, password, { delay: 35 });

  const loginClicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, .el-button, [role="button"]'));
    const target = candidates.find((el) => /(^|\s)登录(\s|$)/.test(String(el.textContent || '').trim()));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    target.click();
    return true;
  });

  if (!loginClicked) {
    throw new Error('Login button "登录" was not found.');
  }

  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
    page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 45000 }).catch(() => null)
  ]);

  return { page };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function captureCookies(ctx) {
  const { data = {}, deps } = ctx;
  const { fsApi } = deps;
  const page = data.page;
  const cookiesPath = data.cookiesPath || DEFAULT_COOKIES_PATH;
  let cookies = await page.cookies('https://oms.xlwms.com', 'https://oms.xlwms.com/platform/order/list');
  if (!Array.isArray(cookies) || cookies.length === 0) {
    cookies = await page.cookies();
  }
  await fsApi.mkdir(path.dirname(cookiesPath), { recursive: true });
  await fsApi.writeFile(cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
  return { cookiesPath, count: Array.isArray(cookies) ? cookies.length : 0 };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function captureStorageState(ctx) {
  const { data = {}, deps } = ctx;
  const { fsApi } = deps;
  const page = data.page;
  const storagePath = data.storagePath || DEFAULT_STORAGE_PATH;
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
    return {
      origin: window.location.origin,
      localStorage: localStorageState,
      sessionStorage: sessionStorageState
    };
  });
  await fsApi.mkdir(path.dirname(storagePath), { recursive: true });
  await fsApi.writeFile(storagePath, JSON.stringify(state, null, 2), 'utf8');
  return {
    storagePath,
    localStorageKeys: Object.keys(state.localStorage || {}).length,
    sessionStorageKeys: Object.keys(state.sessionStorage || {}).length,
    origin: state.origin
  };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function main(ctx) {
  const { data = {}, deps } = ctx;
  const { puppeteerApi, fsApi, fetchApi, consoleApi } = deps;

  const configInfo = await loadConfig({ data: { configPath: data.configPath }, deps: { fsApi } });
  const portInfo = await findCdpPort({ data: { startPort: data.startPort, endPort: data.endPort }, deps: { fetchApi } });

  const browser = await puppeteerApi.connect({
    browserURL: `http://127.0.0.1:${portInfo.port}`,
    defaultViewport: null,
    protocolTimeout: 90000
  });

  try {
    const fillResult = await fillAndLogin({
      data: {
        browser,
        username: configInfo.username,
        password: configInfo.password,
        loginUrl: data.loginUrl
      },
      deps: {}
    });

    const cookieResult = await captureCookies({
      data: { page: fillResult.page, cookiesPath: data.cookiesPath || configInfo.cookiesPath },
      deps: { fsApi }
    });
    const storageResult = await captureStorageState({
      data: { page: fillResult.page, storagePath: data.storagePath || configInfo.storagePath },
      deps: { fsApi }
    });

    consoleApi.log(
      JSON.stringify(
        {
          ok: true,
          cdpPort: portInfo.port,
          configPath: configInfo.configPath,
          currentUrl: fillResult.page.url(),
          cookiesPath: cookieResult.cookiesPath,
          cookiesCount: cookieResult.count,
          storagePath: storageResult.storagePath,
          storageOrigin: storageResult.origin,
          localStorageKeys: storageResult.localStorageKeys,
          sessionStorageKeys: storageResult.sessionStorageKeys,
          usernameLength: configInfo.username.length,
          passwordLength: configInfo.password.length
        },
        null,
        2
      )
    );
  } finally {
    await browser.disconnect();
  }
}

main({
  data: {
    configPath: process.env.OMS_CONFIG_PATH || DEFAULT_CONFIG_PATH,
    cookiesPath: process.env.OMS_COOKIES_PATH || DEFAULT_COOKIES_PATH,
    storagePath: process.env.OMS_STORAGE_PATH || DEFAULT_STORAGE_PATH,
    loginUrl: process.env.OMS_LOGIN_URL || 'https://oms.xlwms.com/login',
    startPort: process.env.CDP_PORT_START || 9222,
    endPort: process.env.CDP_PORT_END || 9265
  },
  deps: {
    puppeteerApi: puppeteer,
    fsApi: fs,
    fetchApi: fetch,
    consoleApi: console
  }
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
