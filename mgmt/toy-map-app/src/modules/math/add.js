/**
 * Add two numbers from ctx.data.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {number}
 */
export function add(ctx) {
  const { data = {} } = ctx;
  const { a = 0, b = 0 } = data;
  return Number(a) + Number(b);
}
