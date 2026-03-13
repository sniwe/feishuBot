# Step 10 - Capture Cookies to mgmt/config

Goal: persist the authenticated browser cookies after login navigation.

Output path:
- `C:\Users\Qub\oms\mgmt\config\oms.cookies.json`

Action:
- Read cookies from current page context.
- Write pretty JSON to the output path.

Expected result:
- Cookie file is created/updated under `mgmt\config`.
