const { spawn } = require('child_process');
const path = require('path');

const TICK_MS = Number(process.env.OMS_FAST_FLOW_TICK_MS || 60_000);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

let running = false;
let tickCount = 0;
let timer = null;
let stopping = false;

function nowIso() {
  return new Date().toISOString();
}

function runFastFlowOnce() {
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCmd, ['--prefix', 'src/backend/oms/app', 'run', 'action:fast-flow-last2h'], {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      resolve(code || 0);
    });
    child.on('error', () => {
      resolve(1);
    });
  });
}

async function tick() {
  if (running || stopping) return;
  running = true;
  tickCount += 1;
  const startedAt = Date.now();
  console.log(`[loop-fast-flow] tick=${tickCount} started_at=${nowIso()}`);
  const code = await runFastFlowOnce();
  const elapsedMs = Date.now() - startedAt;
  console.log(`[loop-fast-flow] tick=${tickCount} exit_code=${code} elapsed_ms=${elapsedMs} finished_at=${nowIso()}`);
  running = false;
}

function start() {
  console.log(`[loop-fast-flow] starting interval tick_ms=${TICK_MS} workspace=${WORKSPACE_ROOT}`);
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

