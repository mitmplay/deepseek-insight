/**
 * Ambient declarations for monaco-editor >= 0.57 ESM worker entry points.
 *
 * 0.57 stopped shipping per-file .d.ts next to the esm worker/contribution
 * modules (only editor.api.d.ts remains), so these side-effect-only imports
 * — re-exported through the settings-*-worker.ts ?worker shims — stopped
 * resolving for svelte-check. The modules exist and are side-effect-only,
 * so each is declared with no exports (RCA: monaco-editor 0.57.0 bump).
 */
declare module 'monaco-editor/esm/vs/editor/editor.worker.js';
declare module 'monaco-editor/esm/vs/language/css/css.worker.js';
declare module 'monaco-editor/esm/vs/language/html/html.worker.js';
declare module 'monaco-editor/esm/vs/language/json/json.worker.js';
declare module 'monaco-editor/esm/vs/language/typescript/ts.worker.js';
