# Step 10 - Capture Session Artifacts to mgmt/config

Goal: persist authenticated session artifacts after login navigation.

Output paths:
- `C:\Users\Qub\oms\mgmt\config\oms.cookies.json`
- `C:\Users\Qub\oms\mgmt\config\oms.cookies.storage.json`

Action:
- Read cookies from current page context.
- Read `localStorage` / `sessionStorage` from current origin.
- Write pretty JSON to both output paths.

Expected result:
- Cookie and storage files are created/updated under `mgmt\config`.
