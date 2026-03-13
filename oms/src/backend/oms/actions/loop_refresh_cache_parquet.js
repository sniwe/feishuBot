const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TICK_MS = 60_000;
const tickMs = Number(process.env.OMS_CACHE_TICK_MS || DEFAULT_TICK_MS);
const maxTicks = Number(process.env.OMS_CACHE_MAX_TICKS || 0);
const runOnce = /^(1|true|yes|on)$/i.test(String(process.env.OMS_CACHE_LOOP_ONCE || '').trim());
const runTkOrdersAction = !/^(0|false|no|off)$/i.test(String(process.env.OMS_TK_CACHE_ENABLED || '1').trim());
const tickPageSize = Number(process.env.OMS_TICK_PAGE_SIZE || 500);
const actionSteps = [
  {
    script: path.join(__dirname, 'refresh_and_cache_oms_orders_parquet.js'),
    env: {
      OMS_ENSURE_PAGE_SIZE_EACH_TICK: '1',
      OMS_TARGET_PAGE_SIZE: String(tickPageSize)
    }
  },
  ...(runTkOrdersAction
    ? [{ script: path.join(__dirname, 'refresh_and_cache_tk_orders_parquet.js'), env: {} }]
    : [])
];

if (!Number.isFinite(tickMs) || tickMs < 5_000) {
  console.error(`Invalid OMS_CACHE_TICK_MS=${process.env.OMS_CACHE_TICK_MS}. Use >= 5000 ms.`);
  process.exit(1);
}
if (!Number.isFinite(maxTicks) || maxTicks < 0) {
  console.error(`Invalid OMS_CACHE_MAX_TICKS=${process.env.OMS_CACHE_MAX_TICKS}. Use >= 0.`);
  process.exit(1);
}

let stopped = false;
let tickCount = 0;

function fmtNow() {
  return new Date().toISOString();
}

function runActionScript(actionScript, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [actionScript], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => resolve(false));
  });
}

async function runSingleTick() {
  for (const step of actionSteps) {
    const ok = await runActionScript(step.script, step.env);
    if (!ok) {
      return false;
    }
  }
  return true;
}

async function main() {
  console.log(
    `[tick-loop] starting; cadence=${tickMs}ms runOnce=${runOnce ? 1 : 0} maxTicks=${maxTicks} tkCache=${runTkOrdersAction ? 1 : 0} pageSize=${tickPageSize} at=${fmtNow()}`
  );
  while (!stopped) {
    tickCount += 1;
    const tickStarted = Date.now();
    console.log(`[tick-loop] tick=${tickCount} start=${fmtNow()}`);

    const ok = await runSingleTick();
    const elapsed = Date.now() - tickStarted;
    console.log(`[tick-loop] tick=${tickCount} done ok=${ok ? 1 : 0} elapsedMs=${elapsed}`);

    if (runOnce || stopped || (maxTicks > 0 && tickCount >= maxTicks)) {
      break;
    }

    const sleepMs = Math.max(0, tickMs - elapsed);
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }
  console.log(`[tick-loop] stopped at=${fmtNow()}`);
}

process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});

main().catch((error) => {
  console.error(`[tick-loop] fatal: ${error.message || error}`);
  process.exit(1);
});
