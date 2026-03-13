# Step 03 - Discover CDP Port

Goal: identify active CDP port for the running OMS browser.

Action:
- Probe localhost ports `9222-9265`:
  - `/json/version`
  - `/json/list`

Selection rule:
- Prefer a port with OMS login page target.
- Otherwise use latest/viable OMS-related port.
