import { runToyApp } from './src/index.js';

const ctx = {
  data: {
    a: 2,
    b: 3,
    name: 'Map Tester',
    includeTime: true
  },
  deps: {
    nowIso: () => new Date().toISOString(),
    log: (...args) => console.log(...args)
  }
};

const result = runToyApp(ctx);
ctx.deps.log(result);
