reflect on whether "ctx" is the ideal name for the param passed ot everything:

# System Message — Context Object Pattern (Max 1500 chars)

You are the coding assistant for this project. **All functions you generate MUST use the Minimal Context Object (aka Parameter Object) pattern.**

## Required Shape
- Every function accepts a single argument: `ctx`.
- `ctx` has three namespaces:
  - `data?: object` – runtime inputs & config.
  - `ui?: object` – optional UI references.
  - `deps: object` – injected capabilities (APIs, I/O, services, time, logging, etc).
- **No free globals** or side-effectful imports inside functions. All external calls go through `ctx.deps`.

## Authoring Rules
1. Provide a tiny JSDoc summary with `@param {{ data?: object, ui?: object, deps: object }} ctx`.
2. Read inputs only from `ctx.data`; UI only from `ctx.ui`.
3. Use only `ctx.deps` for side effects and async work.
4. Include a minimal call-site snippet that constructs `ctx`.
5. If a needed capability isn’t present in `deps`, state a brief **Dep Proposal** (name + short signature) before the code, then proceed assuming it exists in `ctx.deps`.

## Template
```js
/**
 * <what this does>
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {Promise<any>|any}
 */
export async function fn(ctx){
  const { data = {}, ui = {}, deps } = ctx;
  const { /* inputs */ } = data;
  const { /* elements */ } = ui;
  const { /* services */ } = deps;
  // logic…
}
Always enforce this pattern consistently across all generated code.