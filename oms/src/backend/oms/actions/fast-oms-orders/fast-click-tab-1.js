const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'mgmt', 'config', 'oms.config.json');
const DEFAULT_ORDERS_URL = 'https://oms.xlwms.com/platform/order/list';

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '');
}

function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return Array.isArray(overrideValue) ? overrideValue : Array.isArray(baseValue) ? baseValue : [];
  }
  if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
    const out = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      out[key] = mergeDeep(baseValue[key], value);
    }
    return out;
  }
  return overrideValue !== undefined ? overrideValue : baseValue;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function loadLaunchConfig(ctx) {
  const { data = {}, deps } = ctx;
  const { fsApi } = deps;
  const requestedPath = String(data.configPath || DEFAULT_CONFIG_PATH);
  const configPath = path.isAbsolute(requestedPath) ? requestedPath : path.resolve(process.cwd(), requestedPath);
  const localPath =
    String(data.localConfigPath || process.env.OMS_CONFIG_LOCAL_PATH || '').trim() ||
    path.resolve(path.dirname(configPath), 'oms.config.local.json');
  const raw = await fsApi.readFile(configPath, 'utf8');
  const baseParsed = JSON.parse(stripBom(raw));
  let localParsed = {};
  try {
    const localRaw = await fsApi.readFile(localPath, 'utf8');
    localParsed = JSON.parse(stripBom(localRaw));
  } catch {
    localParsed = {};
  }
  const parsed = mergeDeep(baseParsed, localParsed);
  const launch = parsed?.oms?.launch || {};
  const debugPort = Number(process.env.CDP_PORT || process.env.DEBUG_PORT || launch.debugPort || 9222);
  const ordersUrl = String(process.env.OMS_ORDERS_URL || parsed?.oms?.ordersUrl || DEFAULT_ORDERS_URL);
  return { configPath, debugPort, ordersUrl };
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function connectFast(ctx) {
  const { data = {}, deps } = ctx;
  const { puppeteerApi } = deps;
  const primaryPort = Number(data.primaryPort || 9222);
  const ports = [primaryPort, primaryPort + 1, primaryPort + 2];
  let lastError = null;
  for (const port of ports) {
    try {
      const browser = await puppeteerApi.connect({
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

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function resolveOrdersPage(ctx) {
  const { data = {} } = ctx;
  const { browser, ordersUrl } = data;
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

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function fastClickTab(ctx) {
  const { data = {} } = ctx;
  const { page } = data;
  await page.waitForSelector('div#tab--1', { visible: true, timeout: 5000 });
  await page.click('div#tab--1');
  const verify = await page.evaluate(() => {
    const el = document.querySelector('div#tab--1');
    if (!el) return { exists: false };
    return {
      exists: true,
      className: String(el.className || ''),
      ariaSelected: el.getAttribute('aria-selected'),
      text: String(el.textContent || '').trim().slice(0, 60)
    };
  });
  return verify;
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function main(ctx) {
  const { data = {}, deps } = ctx;
  const { consoleApi, fsApi, puppeteerApi } = deps;
  const launch = await loadLaunchConfig({ data: { configPath: data.configPath }, deps: { fsApi } });
  const conn = await connectFast({ data: { primaryPort: launch.debugPort }, deps: { puppeteerApi } });
  try {
    const page = await resolveOrdersPage({ data: { browser: conn.browser, ordersUrl: launch.ordersUrl }, deps: {} });
    const verify = await fastClickTab({ data: { page }, deps: {} });
    consoleApi.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'fast-path',
          cdpPort: conn.port,
          configPath: launch.configPath,
          url: page.url(),
          verify
        },
        null,
        2
      )
    );
  } finally {
    await conn.browser.disconnect();
  }
}

main({
  data: {
    configPath: process.env.OMS_CONFIG_PATH || DEFAULT_CONFIG_PATH
  },
  deps: {
    consoleApi: console,
    fsApi: fs,
    puppeteerApi: puppeteer
  }
}).catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
