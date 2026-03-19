# Start ngrok for reserved domain (audioTest)

## Purpose
Bring `https://braggadocian-osteometrical-petronila.ngrok-free.dev` online and route it to the local `audioTest` server.

## What was wrong
1. The command used `--url`, but this installed ngrok CLI version does not support `--url` for `ngrok http`.
2. The local app was not listening on port `80`.
3. `audioTest` backend is configured to listen on port `8787` by default (`PORT = process.env.PORT || 8787` in `src/backend/server.js`).

## Working fix (exact process)
Run from project root:

```powershell
cd C:\Users\Qub\audioTest
```

### 1) Required preflight from AGENTS policy
```powershell
& "C:\Users\Qub\mgmt\scripts\ensure-machine-setup.ps1"
```

### 2) Start the local backend server
```powershell
Start-Process npm.cmd -ArgumentList 'start' -WorkingDirectory 'C:\Users\Qub\audioTest' -PassThru
```

Expected local verification:
```powershell
Invoke-WebRequest -Uri 'http://localhost:8787' -TimeoutSec 10
```
Expect: HTTP 200.

### 3) Stop any old ngrok process (if running)
```powershell
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
```

### 4) Start ngrok with the correct flag and correct port
```powershell
Start-Process ngrok -ArgumentList 'http --domain=braggadocian-osteometrical-petronila.ngrok-free.dev 8787' -PassThru
```

Important:
- Use `--domain`, not `--url`.
- Forward to `8787`, not `80`.

### 5) Verify public endpoint
```powershell
Invoke-WebRequest -Uri 'https://braggadocian-osteometrical-petronila.ngrok-free.dev' -TimeoutSec 20
```
Expect: HTTP 200.

## Known failure signatures and meaning

### A) `unknown flag: --url`
Cause: wrong CLI flag for this ngrok version.
Fix: use `--domain`.

### B) `ERR_NGROK_3200` + endpoint offline
Cause: no tunnel currently bound to the reserved domain.
Fix: start ngrok with `--domain=...`.

### C) `ERR_NGROK_8012` + `dial tcp [::1]:80 ...`
Cause: ngrok tunnel active, but forwarding to wrong port (`80`) where no local server is running.
Fix: point ngrok to `8787` and ensure app is started.

## One-command recovery sequence

```powershell
cd C:\Users\Qub\audioTest
& "C:\Users\Qub\mgmt\scripts\ensure-machine-setup.ps1"
Start-Process npm.cmd -ArgumentList 'start' -WorkingDirectory 'C:\Users\Qub\audioTest' -PassThru
Start-Sleep -Seconds 3
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process ngrok -ArgumentList 'http --domain=braggadocian-osteometrical-petronila.ngrok-free.dev 8787' -PassThru
Invoke-WebRequest -Uri 'https://braggadocian-osteometrical-petronila.ngrok-free.dev' -TimeoutSec 20
```

## Notes for autonomous agents
- Verify both local and public status; local must be healthy first.
- If local check fails, do not troubleshoot ngrok first. Start/fix local server on `8787` first.
- If public check fails with `offline`, tunnel is missing.
- If public check fails with `502/8012`, tunnel exists but upstream target is wrong or down.
