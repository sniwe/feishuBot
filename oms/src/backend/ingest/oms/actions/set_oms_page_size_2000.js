const puppeteer = require('puppeteer');

const PORT_START = Number(process.env.CDP_PORT_START || 9222);
const PORT_END = Number(process.env.CDP_PORT_END || 9260);
const PREFERRED_PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : null;
const TARGET_URL_FRAGMENT = process.env.OMS_TARGET_URL_FRAGMENT || 'oms.xlwms.com/platform/order/list';

async function findWorkingBrowserURL() {
  const ports = [];
  if (Number.isInteger(PREFERRED_PORT) && PREFERRED_PORT > 0) {
    ports.push(PREFERRED_PORT);
  }
  for (let p = PORT_START; p <= PORT_END; p += 1) {
    if (!ports.includes(p)) ports.push(p);
  }

  let fallback = null;
  for (const port of ports) {
    try {
      const versionResp = await fetch(`http://127.0.0.1:${port}/json/version`, { method: 'GET' });
      if (!versionResp.ok) continue;
      const versionData = await versionResp.json();
      if (!versionData || !versionData.webSocketDebuggerUrl) continue;

      const listResp = await fetch(`http://127.0.0.1:${port}/json/list`, { method: 'GET' });
      if (!listResp.ok) {
        if (!fallback) fallback = { browserURL: `http://127.0.0.1:${port}`, port };
        continue;
      }
      const targets = await listResp.json();
      const hasOmsTarget = Array.isArray(targets)
        ? targets.some(
            (t) =>
              t &&
              t.type === 'page' &&
              typeof t.url === 'string' &&
              t.url.includes(TARGET_URL_FRAGMENT)
          )
        : false;

      if (hasOmsTarget) {
        return { browserURL: `http://127.0.0.1:${port}`, port };
      }
      if (!fallback) fallback = { browserURL: `http://127.0.0.1:${port}`, port };
    } catch {
      // Try next port.
    }
  }

  if (fallback) return fallback;

  throw new Error(`No CDP browser found on 127.0.0.1 ports ${PORT_START}-${PORT_END}. Start OMS launcher first (npm run launch:oms).`);
}

async function findOmsPage(browser) {
  const pages = await browser.pages();
  return pages.find((p) => (p.url() || '').includes(TARGET_URL_FRAGMENT)) || null;
}

async function clickByBoundingBox(page, selector) {
  const handle = await page.$(selector);
  if (!handle) return false;
  const box = await handle.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 30 });
  return true;
}

async function main() {
  const { browserURL, port } = await findWorkingBrowserURL();
  const browser = await puppeteer.connect({ browserURL, defaultViewport: null });

  try {
    const page = await findOmsPage(browser);
    if (!page) {
      throw new Error(`No OMS tab found matching URL fragment: ${TARGET_URL_FRAGMENT}`);
    }

    await page.bringToFront();
    await page.waitForSelector('span.el-pagination__sizes .el-input__inner', {
      visible: true,
      timeout: 15_000
    });

    const opened = await clickByBoundingBox(page, 'span.el-pagination__sizes .el-input__inner');
    if (!opened) {
      throw new Error('Failed to click pagination size trigger.');
    }

    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('div.el-select-dropdown.el-popper'));
      return nodes.some((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 10 && r.height > 10;
      });
    }, { timeout: 8_000 });

    const clickResult = await page.evaluate(() => {
      const visibleDropdowns = Array.from(
        document.querySelectorAll('div.el-select-dropdown.el-popper')
      ).filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 10 && r.height > 10;
      });
      if (!visibleDropdowns.length) {
        return { ok: false, reason: 'dropdown_not_visible' };
      }

      const dropdown = visibleDropdowns[visibleDropdowns.length - 1];
      const targets = Array.from(dropdown.querySelectorAll('li, .el-select-dropdown__item, span'));
      const target = targets.find((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /(^|\s)2000\s*条\/页($|\s)/.test(text) || /(^|\s)2000($|\s)/.test(text);
      });
      if (!target) {
        return { ok: false, reason: 'option_2000_not_found' };
      }

      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      target.click();
      return { ok: true, clickedText: (target.textContent || '').replace(/\s+/g, ' ').trim() };
    });

    if (!clickResult.ok) {
      throw new Error(`Failed to select page size 2000: ${clickResult.reason}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    const selected = await page.evaluate(() => {
      const el = document.querySelector('span.el-pagination__sizes .el-input__inner');
      return (el?.value || el?.textContent || '').replace(/\s+/g, ' ').trim();
    });

    console.log(`CDP port: ${port}`);
    console.log(`Clicked: ${clickResult.clickedText}`);
    console.log(`Current page size: ${selected}`);
  } finally {
    await browser.disconnect();
  }
}

main().catch((error) => {
  console.error(`set_oms_page_size_2000 failed: ${error.message || error}`);
  process.exit(1);
});
