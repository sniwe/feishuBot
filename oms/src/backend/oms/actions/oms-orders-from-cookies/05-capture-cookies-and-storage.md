# Step 05 - Capture Cookies and Storage Together

Goal: persist complete session artifacts.

Artifacts to write:
- `oms.cookies.json`
- `oms.cookies.storage.json` (origin + localStorage + sessionStorage)

Capture timing:
- Capture only after login submit and navigation settle.

Negative example:
- Initial orchestrator captured only cookies.
- Result: launch still redirected to login because storage-backed auth context was missing.
