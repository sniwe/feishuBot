import { add } from './modules/math/index.js';
import { buildGreeting } from './modules/greeting/index.js';

/**
 * Compose toy app behavior from modular units.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {{ sum: number, message: string }}
 */
export function runToyApp(ctx) {
  const { data = {}, deps } = ctx;
  const sum = add({ data: { a: data.a, b: data.b }, deps });
  const message = buildGreeting({
    data: { name: data.name, includeTime: data.includeTime },
    deps
  });
  return { sum, message };
}
