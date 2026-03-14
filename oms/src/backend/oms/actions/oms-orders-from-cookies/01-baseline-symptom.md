# Step 01 - Baseline Symptom

Goal: document the failure condition before fixes.

Observed behavior:
- Launch command starts browser but lands on `/login` instead of orders URL.
- This indicates session restore is incomplete.

Expected behavior:
- Launch should open `https://oms.xlwms.com/platform/order/list` directly when valid session artifacts are present.

Negative example (initial state):
- Only `oms.cookies.json` existed; no storage snapshot file was present.
- Result: browser redirected to login despite cookie preload attempt.
