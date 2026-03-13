# Step 09 - Click Login and Wait Navigation

Goal: submit the login form and wait for post-login page transition.

Action:
- Click button with text `登录`.
- Wait for either:
  - URL to change away from `/login`, or
  - navigation (`domcontentloaded`) after submit.

Expected result:
- Login submit is triggered.
- Browser leaves login state or completes post-submit navigation.
