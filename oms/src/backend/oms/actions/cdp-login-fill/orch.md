# orch - CDP Login Fill Flow

This orchestrator chains the substeps for relaunch + CDP login + cookie capture.

## Ordered chain
1. `01-preflight.md`
2. `02-launch-gui-session.md`
3. `03-discover-cdp-port.md`
4. `04-attach-and-target-login-page.md`
5. `05-load-credentials-from-config.md`
6. `06-locate-login-inputs.md`
7. `07-inject-values-via-cdp.md`
8. `08-verify-injection.md`
9. `09-click-login-and-wait-navigation.md`
10. `10-capture-cookies.md`

## Runnable orchestrator script
- `orch.js`

## One-line execution intent
- Relaunch OMS in GUI mode.
- Attach to active CDP browser.
- Fill username/password from `mgmt\\config\\oms.config.json`.
- Click `登录` and wait for post-login navigation.
- Capture cookies into `mgmt\\config\\oms.cookies.json`.
