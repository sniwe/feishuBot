# OMS Stealth Launcher (Minimal)

This module provides a minimal modularized launcher for OMS.

Current scope:
- Launch browser with stealth plugin.
- Reuse existing OMS cookies/storage from `C:\orderBot\mgmt\data\oms`.
- Open OMS orders page and keep the browser session alive ("hang").

## Files
- `launch_oms_stealth.js`: launcher entry point.
- `package.json`: npm scripts and dependencies.

## Install
From this folder:

```powershell
npm install
```

## Run
Visible window:

```powershell
npm run launch:oms
```

Hidden/headless:

```powershell
npm run launch:oms:hidden
```

## Optional environment variables
- `OMS_COOKIES_PATH` (default `C:\orderBot\mgmt\data\oms\cookies.json`)
- `OMS_STORAGE_PATH` (default `C:\orderBot\mgmt\data\oms\cookies.storage.json`)
- `OMS_LOGIN_URL` (default `https://oms.xlwms.com/login`)
- `OMS_ORDERS_URL` (default `https://oms.xlwms.com/platform/order/list`)
- `OMS_HIDDEN=1` for hidden/headless mode
- `DEBUG_PORT` preferred CDP port (defaults to `9222`, auto-increments if busy)
- `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` / `BROWSER_PATH` to force browser binary

