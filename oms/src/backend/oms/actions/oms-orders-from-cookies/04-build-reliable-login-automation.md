# Step 04 - Build Reliable Login Automation

Goal: ensure we can always re-authenticate and regenerate session artifacts.

Automation actions:
- Attach to live CDP browser.
- Locate inputs by placeholders:
  - `请输入账号名`
  - `请输入密码`
- Fill values from config.
- Click `登录`.
- Wait for post-login navigation.

Negative example:
- Injecting values without clicking `登录` does not establish authenticated session.
- Capturing cookies before navigation completion can save incomplete state.
