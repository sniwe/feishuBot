/**
 * Build a greeting string and optionally include current time.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {string}
 */
export function buildGreeting(ctx) {
  const { data = {}, deps } = ctx;
  const { name = 'World', includeTime = false } = data;
  const nowIso = includeTime && deps.nowIso ? ` @ ${deps.nowIso()}` : '';
  return `Hello, ${name}${nowIso}`;
}
