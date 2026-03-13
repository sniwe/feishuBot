# Step 04 - Attach and Target Login Page

Goal: connect to active browser and focus OMS login page.

Action:
- Use Puppeteer CDP attach:
  - `puppeteer.connect({ browserURL: "http://127.0.0.1:<port>" })`
- Select an existing OMS login tab if present.
- If not on login page, navigate to:
  - `https://oms.xlwms.com/login`
