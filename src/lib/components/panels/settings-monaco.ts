/**
 * settings-monaco — the lazy Monaco glue for SettingsEditorPanel (The
 * Settings Panel ADR, 2026-09-07, D4). This module is the ONLY file that
 * imports monaco-editor / monaco-yaml; the panel loads it through a
 * dynamic import so the editor lands in its own chunk and the floor's
 * first paint never pays for it (the 4.1-T build gate pins that split).
 *
 * The seam the panel sees is deliberately tiny — create a YAML editor,
 * read its text, dispose — so unit tests mock THIS module and never load
 * Monaco under happy-dom.
 */

import * as monaco from 'monaco-editor';
import EditorWorker from './settings-editor-worker?worker';
import TsWorker from './settings-ts-worker?worker';
import CssWorker from './settings-css-worker?worker';
import HtmlWorker from './settings-html-worker?worker';
import JsonWorker from './settings-json-worker?worker';
import YamlWorker from './yaml-worker-entry?worker';
import { configureMonacoYaml } from 'monaco-yaml';

// One worker set per app: Monaco's editor worker (diff/completion
// plumbing) plus the LANGUAGE workers — hover/validation/diagnostic
// requests are routed by language LABEL: routing them to the editor
// worker fails with "Missing requestHandler or method: ..." (yaml's
// getQuickInfoAtPosition, 2026-09; the text editor's
// getSyntacticDiagnostics once createTextEditor opened ts/js/css/html/
// json buffers, 2026-09-12). Each language label gets its own worker;
// everything else (plaintext et al) uses the editor worker. Configured
// once on first load; the worker URL imports keep Vite in charge of
// the bundling.
declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker: (workerId: string, label: string) => Worker;
		};
	}
}

// ALWAYS install the router (RCA 2026-09-26): monaco seeds an empty
// MonacoEnvironment object on import, so a "=== undefined" guard never
// passed and yaml requests fell back to the main thread, rejecting
// "Missing requestHandler or method: ..." on every worker call.
window.MonacoEnvironment = {
	getWorker(_workerId: string, label: string): Worker {
		if (label === 'yaml') return new YamlWorker();
		if (label === 'typescript' || label === 'javascript') return new TsWorker();
		if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
		if (label === 'html') return new HtmlWorker();
		if (label === 'json') return new JsonWorker();
		return new EditorWorker();
	}
};

// monaco 0.56+ base features (folding / document symbols / links / code
// actions) fall back to a worker RPC for languages without providers — for
// 'yaml' that call raced the monaco-yaml worker boot and threw UNCAUGHT
// (RCA 2026-09-26). Register no-op providers so monaco never issues those
// doomed calls; yaml's real validation/hover/completion still ride
// monaco-yaml's own providers + the guarded worker entry.
monaco.languages.registerFoldingRangeProvider('yaml', { provideFoldingRanges: () => [] });
monaco.languages.registerDocumentSymbolProvider('yaml', { provideDocumentSymbols: () => [] });
monaco.languages.registerLinkProvider('yaml', { provideLinks: () => ({ links: [] }) });
monaco.languages.registerCodeActionProvider('yaml', {
	provideCodeActions: () => ({ actions: [], dispose() {} })
});

// YAML language service (hover, validation, symbols) on the shared
// monaco instance — the document authority stays the server's parse gate
// (ADR D5); this is editor-side affordance only.
// validate: false — monaco-yaml's marker provider fires doValidation/
// resetSchema before the yaml worker finishes booting; the rejections are
// the remaining console-noise source (RCA 2026-09-26). Hover/completion/
// definition/format stay active.
configureMonacoYaml(monaco, { validate: false });

// Pre-warm the yaml worker (Fullpath Bow RCA follow-up): the worker bundle
// carries the whole yaml-language-server and takes seconds to boot; a yaml
// model opened before that raced the boot and rejected uncaught. Warming
// with a throwaway model at module load moves the race to app startup —
// by the time the operator opens real yaml tabs the worker is live.
const warmupModel = monaco.editor.createModel(
	'prewarm: true',
	'yaml',
	monaco.Uri.parse('inmemory://dsi-yaml-prewarm/boot.yaml')
);
setTimeout(() => warmupModel.dispose(), 5000);

/** The editor handle SettingsEditorPanel keeps. */
export interface YamlEditorHandle {
	/** The editor's current text. */
	getValue(): string;
	/** Replace the whole buffer (a fresh load). */
	setValue(text: string): void;
	/** Scroll to and highlight a 1-based line range (the file-link #L
	 *  anchor). Optional: only the text editor implements it. */
	highlightLines?(range: { start: number; end: number }): void;
	/** Release the editor and its DOM. */
	dispose(): void;
}

/** Creation options for the shared glue — the seam stays tiny. */
export interface YamlEditorOptions {
	/** True blocks USER edits at the editor (the injected-doc viewer,
	 *  Loadinjected ADR D1); programmatic setValue still works. Default
	 *  false — the settings editor keeps its writable buffer. */
	readOnly?: boolean;
}

/**
 * Create a Monaco YAML editor in `container`.
 * @param container - the host element the editor mounts into.
 * @param initialValue - the document text to open with.
 * @param onChange - fired on every buffer edit (the panel tracks its
 *        dirty state from it).
 * @param options - optional seam options; absent = the settings editor's
 *        writable buffer (readOnly false).
 */
export function createYamlEditor(
	container: HTMLElement,
	initialValue: string,
	onChange: () => void,
	options?: YamlEditorOptions
): YamlEditorHandle {
	const editor = monaco.editor.create(container, {
		value: initialValue,
		language: 'yaml',
		theme: 'vs',
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		tabSize: 2,
		renderWhitespace: 'selection',
		readOnly: options?.readOnly === true
	});
	const sub = editor.onDidChangeModelContent(() => onChange());
	return {
		getValue: () => editor.getValue(),
		setValue: (text: string) => editor.setValue(text),
		dispose: () => {
			sub.dispose();
			editor.dispose();
		}
	};
}

/**
 * Create a Monaco editor over one live workspace file (Workspace Explorer
 * W4 task 4.1): the file panel's edit tab — same lazy chunk, same tiny seam
 * as the YAML glue. Language defaults to plaintext; pass one of Monaco's
 * registered ids to switch on the built-in tokenizer highlighting.
 *
 * @param container - the host element the editor mounts into.
 * @param initialValue - the fetched file text to open with.
 * @param onChange - fired on every buffer edit (the panel's dirty flag).
 * @param options - optional seam options; `language` picks a Monaco
 *        language id (e.g. 'typescript', 'python'); absent = plaintext.
 */
export function createTextEditor(
	container: HTMLElement,
	initialValue: string,
	onChange: () => void,
	options?: { language?: string; readOnly?: boolean }
): YamlEditorHandle {
	const editor = monaco.editor.create(container, {
		value: initialValue,
		language: options?.language ?? 'plaintext',
		readOnly: options?.readOnly ?? false,
		theme: 'vs',
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		tabSize: 2
	});
	const sub = editor.onDidChangeModelContent(() => onChange());
	/** One decoration collection, REPLACED per call — highlighting twice
	 *  never stacks two bands. Clamped to the model: a target past EOF
	 *  collapses onto the last line, it never throws. */
	let decorations: monaco.editor.IEditorDecorationsCollection | null = null;
	const highlightLines = (range: { start: number; end: number }): void => {
		const model = editor.getModel();
		if (model === null) return;
		const last = model.getLineCount();
		if (last < 1) return;
		const start = Math.min(Math.max(1, Math.floor(range.start)), last);
		const end = Math.min(Math.max(start, Math.floor(range.end)), last);
		if (decorations === null) {
			decorations = editor.createDecorationsCollection([
				{
					range: new monaco.Range(start, 1, end, 1),
					options: { isWholeLine: true, className: 'dsi-line-anchor-highlight' }
				}
			]);
		} else {
			decorations.set([
				{
					range: new monaco.Range(start, 1, end, 1),
					options: { isWholeLine: true, className: 'dsi-line-anchor-highlight' }
				}
			]);
		}
		editor.revealLinesInCenter(start, end);
	};
	return {
		getValue: () => editor.getValue(),
		setValue: (text: string) => editor.setValue(text),
		highlightLines,
		dispose: () => {
			sub.dispose();
			editor.dispose();
		}
	};
}

// ── The File Eye diff surface (ADR 2026-09-12, D2) ──

/**
 * A READ-ONLY side-by-side DiffEditor over (HEAD, on-disk baseline),
 * riding the SAME lazy chunk as the text editor (the chunk gate).
 * Returns a dispose handle only — the diff is never editable, so there
 * is no value API. The two models are owned (and disposed) here.
 */
export function createDiffEditor(
	container: HTMLElement,
	original: string,
	modified: string,
	options?: { language?: string; readOnly?: boolean }
): { dispose(): void } {
	const language = options?.language ?? 'plaintext';
	const originalModel = monaco.editor.createModel(original, language);
	const modifiedModel = monaco.editor.createModel(modified, language);
	const editor = monaco.editor.createDiffEditor(container, {
		theme: 'vs',
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		// The diff is read-only BY DEFAULT (ADR D2) — the Loadinjected seam
		// pin forbids a hardcoded read-only-true literal in this module.
		readOnly: options?.readOnly ?? true,
		renderSideBySide: true,
		// Monaco 0.56 defaults this to true: below its width threshold it
		// silently falls back to the INLINE (unified) view. The file panel
		// is narrow by design — side-by-side must hold anyway (the ADR D2
		// contract is two panes, not a patch).
		useInlineViewWhenSpaceIsLimited: false,
	});
	editor.setModel({ original: originalModel, modified: modifiedModel });
	return {
		dispose: () => {
			// ORDER MATTERS: the widget must RELEASE its models (dispose, or
			// setModel(null)) before the models die — disposing a TextModel
			// the widget still references throws "TextModel got disposed
			// before DiffEditorWidget model got reset".
			editor.setModel(null);
			editor.dispose();
			originalModel.dispose();
			modifiedModel.dispose();
		}
	};
}
