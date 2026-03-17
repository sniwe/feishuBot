const { spawn } = require('child_process');
const path = require('path');

const TICK_MS = Number(process.env.OMS_FAST_FLOW_TICK_MS || 60_000);
const RUN_TIMEOUT_MS = Number(process.env.OMS_FAST_FLOW_RUN_TIMEOUT_MS || TICK_MS);
const MAX_TICKS = Number(process.env.OMS_FAST_FLOW_MAX_TICKS || 0);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

let running = false;
let tickCount = 0;
let timer = null;
let stopping = false;

function nowIso() {
  return new Date().toISOString();
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      resolve();
      return;
    }
    setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore when already exited
      }
      resolve();
    }, 3000);
  });
}

function runFastFlowOnce() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    const child =
      process.platform === 'win32'
        ? spawn(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/s', '/c', 'npm.cmd --prefix src/backend/oms/app run action:fast-flow-last2h'],
            {
              cwd: WORKSPACE_ROOT,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true
            }
          )
        : spawn('npm', ['--prefix', 'src/backend/oms/app', 'run', 'action:fast-flow-last2h'], {
            cwd: WORKSPACE_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
          });

    if (child.stdout) {
      child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid)
        .catch(() => {})
        .finally(() => {
          if (!settled) {
            settled = true;
            resolve({ code: 124, timedOut: true, elapsedMs: Date.now() - startedAt });
          }
        });
    }, RUN_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ code: code || 0, timedOut, elapsedMs: Date.now() - startedAt });
      }
    });

    child.on('error', () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ code: 1, timedOut, elapsedMs: Date.now() - startedAt });
      }
    });
  });
}

async function tick() {
  if (running || stopping) return;
  running = true;
  tickCount += 1;
  const startedAt = Date.now();
  console.log(`[loop-fast-flow] tick=${tickCount} started_at=${nowIso()}`);
  const result = await runFastFlowOnce();
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[loop-fast-flow] tick=${tickCount} exit_code=${result.code} timed_out=${result.timedOut ? 1 : 0} elapsed_ms=${elapsedMs} finished_at=${nowIso()}`
  );
  running = false;
  if (MAX_TICKS > 0 && tickCount >= MAX_TICKS) {
    shutdown(`MAX_TICKS_${MAX_TICKS}`);
  }
}

function start() {
  console.log(
    `[loop-fast-flow] starting interval tick_ms=${TICK_MS} run_timeout_ms=${RUN_TIMEOUT_MS} max_ticks=${MAX_TICKS} workspace=${WORKSPACE_ROOT}`
  );
  tick().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, TICK_MS);
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`[loop-fast-flow] received ${signal}, shutting down at ${nowIso()}`);
  // allow current tick to complete
  const wait = setInterval(() => {
    if (!running) {
      clearInterval(wait);
      process.exit(0);
    }
  }, 200);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
