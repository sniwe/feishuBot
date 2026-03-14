# Step 06 - Validate with Fresh Launch Port

Goal: confirm restore works from a clean launch context.

Validation pattern:
- Launch on a fresh CDP port (example: `9255`).
- Query CDP targets and inspect active page URL/title.

Success criteria:
- URL resolves to `https://oms.xlwms.com/platform/order/list`.
- Page title reflects OMS orders page.

Negative example:
- Validating against an old/stale browser instance can produce false positives.
- Always test with a fresh launch process/port.
