# Step 02 - Confirm Config Wiring

Goal: verify launcher and config paths point to the governed project location.

Required paths:
- `${WORKSPACE_ROOT}\mgmt\config\oms.config.json`
- `${WORKSPACE_ROOT}\mgmt\config\oms.cookies.json`
- `${WORKSPACE_ROOT}\mgmt\config\oms.cookies.storage.json`

Checks:
- `ordersUrl` is `https://oms.xlwms.com/platform/order/list`.
- `cookiesPath` and `storagePath` are under `mgmt\\config`.

Negative example:
- Older defaults pointed to unrelated paths like `C:\orderBot\...`.
- That mismatch silently prevented consistent session restore.
