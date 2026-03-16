# Step 01 - Preflight

Goal: confirm prerequisites before automation.

Checks:
- OMS config file exists at `${WORKSPACE_ROOT}\mgmt\config\oms.config.json`.
- `oms.credentials.username` and `oms.credentials.password` are present.
- Chrome CDP endpoint is reachable on localhost in range `9222-9265`.

Pass criteria:
- Config exists and both credentials are non-empty.
- At least one CDP port responds to `/json/version` with `webSocketDebuggerUrl`.
