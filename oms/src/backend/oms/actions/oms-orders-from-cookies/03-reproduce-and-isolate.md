# Step 03 - Reproduce and Isolate

Goal: reproduce failure and isolate likely missing artifact type.

Method:
- Launch with current config.
- Observe whether final URL is login or orders.

Isolation outcome:
- Cookie file alone is insufficient for this site flow.
- OMS requires additional browser state from storage for stable auth restoration.

Negative example:
- Re-running launch repeatedly with only cookie refresh did not fix redirect-to-login behavior.
