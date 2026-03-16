# Step 05 - Load Credentials from Config

Goal: load input values from project config source.

Source:
- `${WORKSPACE_ROOT}\mgmt\config\oms.config.json`

Fields:
- `oms.credentials.username`
- `oms.credentials.password`

Handling:
- Do not print raw secrets.
- Log only presence/length metadata for verification.
