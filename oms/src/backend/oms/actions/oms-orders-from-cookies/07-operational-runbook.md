# Step 07 - Operational Runbook

Goal: codify repeatable command sequence.

Recommended sequence:
1. `npm run launch:oms` (open GUI session)
2. If redirected to login, run:
   - `npm run action:login-cdp-and-capture-cookies`
3. Relaunch:
   - `npm run launch:oms`
4. Verify orders URL load.

Recovery note:
- If login state expires, repeat step 2 to recapture both artifacts.

Negative example:
- Recapturing only cookies and skipping storage recapture can reintroduce login redirect.
