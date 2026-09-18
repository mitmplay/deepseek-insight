/**
 * The Monaco TypeScript/JavaScript language worker shim — same shape as
 * settings-editor-worker.ts: a module file so the glue can import it as
 * a relative `?worker` asset (Vite's reliably-resolvable form). Rides
 * the vite.config alias for the monaco-editor esm deep path.
 */
import 'monaco-editor/language/typescript/ts.worker.js';
