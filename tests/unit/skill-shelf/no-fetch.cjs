// Test-side fetch stub for shelf.mjs engine subprocesses (spawned via
// execFileSync in helpers.ts, so vitest stubs cannot reach them).
// shelf.mjs's buildSnapshot fetches raw.githubusercontent.com overviews for
// every uninstalled skill even under --fixture-root (not fixture-gated there).
// Fail every fetch immediately so the engine degrades to overview:null with
// zero network I/O; installs themselves stay on the local fixture copy.
globalThis.fetch = () => Promise.reject(new Error('network disabled in tests'))
