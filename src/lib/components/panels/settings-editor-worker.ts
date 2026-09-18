/**
 * The Monaco editor worker shim — a module file so the glue can import
 * it as a relative `?worker` asset (Vite's reliably-resolvable form;
 * package-subpath worker queries fail import analysis under vitest).
 * Bundled as the editor's web worker at build time. The specifier rides
 * monaco's exports map (`./X` → `./esm/vs/X.js`).
 */
import 'monaco-editor/editor/editor.worker.js';
