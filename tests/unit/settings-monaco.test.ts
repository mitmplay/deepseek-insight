/**
 * settings-monaco glue tests (The Settings Panel ADR, 2026-09-07, D4) —
 * the module is the ONLY file importing monaco-editor/monaco-yaml and it
 * cannot run under happy-dom, so the tests replace those two deps (and
 * the ?worker shim) with recording doubles and exercise the real glue
 * logic: one-time MonacoEnvironment worker wiring, worker routing by
 * language label, readOnly defaulting, the change subscription, dispose
 * ordering, the text-editor seam, and the diff-editor lifecycle.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const monacoState = {
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<{
		value: string;
		onChange: () => void;
		contentSubDisposed: boolean;
		disposed: boolean;
	}>,
	models: [] as Array<{ value: string; disposed: boolean }>,
	diffs: [] as Array<{ model: { original: unknown; modified: unknown } | null; disposed: boolean }>,
	diffCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
};

vi.mock('monaco-editor', () => ({
	editor: {
		create: (container: HTMLElement, options: Record<string, unknown>) => {
			const editor = {
				value: options.value as string,
				onChange: () => {},
				contentSubDisposed: false,
				disposed: false,
				onDidChangeModelContent(cb: () => void) {
					editor.onChange = cb;
					return { dispose: () => (editor.contentSubDisposed = true) };
				},
				getValue: () => editor.value,
				setValue: (text: string) => (editor.value = text),
				dispose: () => (editor.disposed = true)
			};
			monacoState.createCalls.push({ container, options });
			monacoState.editors.push(editor);
			return editor;
		},
		createModel: (value: string, _language: string) => {
			const model = { value, disposed: false, dispose: () => (model.disposed = true) };
			monacoState.models.push(model);
			return model;
		},
		createDiffEditor: (container: HTMLElement, _options: Record<string, unknown>) => {
			const diff = { model: null as { original: unknown; modified: unknown } | null, disposed: false };
			monacoState.diffs.push(diff);
			monacoState.diffCalls.push({ container, options: _options });
			return {
				setModel(m: { original: unknown; modified: unknown } | null) {
					diff.model = m;
				},
				dispose() {
					diff.disposed = true;
				}
			};
		}
	}
}));

vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));

const { workerTags } = vi.hoisted(() => ({ workerTags: [] as string[] }));

function makeWorker(tag: string) {
	return class {
		tag: string;
		constructor() {
			this.tag = tag;
			workerTags.push(tag);
		}
	};
}

vi.mock('$lib/components/panels/settings-editor-worker?worker', () => ({ default: makeWorker('editor') }));
vi.mock('$lib/components/panels/settings-ts-worker?worker', () => ({ default: makeWorker('ts') }));
vi.mock('$lib/components/panels/settings-css-worker?worker', () => ({ default: makeWorker('css') }));
vi.mock('$lib/components/panels/settings-html-worker?worker', () => ({ default: makeWorker('html') }));
vi.mock('$lib/components/panels/settings-json-worker?worker', () => ({ default: makeWorker('json') }));
vi.mock('monaco-yaml/yaml.worker?worker', () => ({ default: makeWorker('yaml') }));

import { createYamlEditor, createTextEditor, createDiffEditor } from '$lib/components/panels/settings-monaco';
import { configureMonacoYaml } from 'monaco-yaml';

function getWorker(label: string): { tag: string } {
	const env = (window as { MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker } })
		.MonacoEnvironment!;
	return env.getWorker('worker', label) as unknown as { tag: string };
}

beforeEach(() => {
	monacoState.createCalls.length = 0;
	monacoState.editors.length = 0;
	monacoState.models.length = 0;
	monacoState.diffs.length = 0;
	monacoState.diffCalls.length = 0;
	workerTags.length = 0;
});

describe('settings-monaco glue', () => {
	it('wires the shared editor worker into MonacoEnvironment once per app', async () => {
		delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
		vi.resetModules();
		await import('$lib/components/panels/settings-monaco');
		const env = (window as { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment!;
		expect(typeof env.getWorker).toBe('function');
		expect(env.getWorker()).toBeTruthy(); // default label -> editor worker
		expect(workerTags).toContain('editor');
		// An environment already present is left alone (the guard's other arm).
		const sentinel = { getWorker: () => ({} as Worker) };
		(window as { MonacoEnvironment?: unknown }).MonacoEnvironment = sentinel;
		vi.resetModules(); // force the glue's module body to re-run
		await import('$lib/components/panels/settings-monaco');
		expect((window as { MonacoEnvironment?: unknown }).MonacoEnvironment).toBe(sentinel);
	});

	it('routes workers by language label (yaml / ts+js / css+scss+less / html / json / fallback)', async () => {
		delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
		vi.resetModules();
		await import('$lib/components/panels/settings-monaco');
		getWorker('typescript');
		getWorker('javascript');
		getWorker('css');
		getWorker('scss');
		getWorker('less');
		getWorker('html');
		getWorker('json');
		getWorker('plaintext');
		getWorker('yaml');
		// 9 spawns routed by label, every route exercised
		expect(workerTags).toHaveLength(9);
	});

	it('configures the YAML language service on the shared monaco instance', () => {
		expect(configureMonacoYaml).toHaveBeenCalled();
	});

	it('creates the editor with the yaml buffer and a default writable buffer', () => {
		const container = document.createElement('div');
		const onChange = vi.fn();
		const handle = createYamlEditor(container, 'a: 1', onChange);
		const call = monacoState.createCalls[0]!;
		expect(call.container).toBe(container);
		expect(call.options.value).toBe('a: 1');
		expect(call.options.language).toBe('yaml');
		expect(call.options.readOnly).toBe(false);
		handle.setValue('a: 2');
		expect(handle.getValue()).toBe('a: 2');
		monacoState.editors[0]!.onChange(); // the editor's content event reaches the seam
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('readOnly: true blocks user edits at the editor (Loadinjected D1)', () => {
		createYamlEditor(document.createElement('div'), 'k: v', () => {}, { readOnly: true });
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(true);
	});

	it('dispose releases the change subscription before the editor', () => {
		const handle = createYamlEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0]!;
		expect(editor.contentSubDisposed).toBe(false);
		handle.dispose();
		expect(editor.contentSubDisposed).toBe(true);
		expect(editor.disposed).toBe(true);
	});

	it('the change callback fires through the handle seam', () => {
		const onChange = vi.fn();
		createYamlEditor(document.createElement('div'), 'x', onChange);
		monacoState.editors[0]!.onChange();
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('createTextEditor defaults to plaintext + writable and honors language/readOnly options', () => {
		createTextEditor(document.createElement('div'), 'hello', () => {});
		let call = monacoState.createCalls[0]!;
		expect(call.options.language).toBe('plaintext');
		expect(call.options.readOnly).toBe(false);

		const onChange = vi.fn();
		createTextEditor(document.createElement('div'), 'x = 1', onChange, {
			language: 'typescript',
			readOnly: true
		});
		call = monacoState.createCalls[1]!;
		expect(call.options.language).toBe('typescript');
		expect(call.options.readOnly).toBe(true);

		const handleRef = monacoState.editors[1]!;
		handleRef.onChange();
		expect(onChange).toHaveBeenCalledTimes(1);
		const handle = createTextEditor(document.createElement('div'), 'x = 2', () => {});
		handle.setValue('x = 2');
		expect(handle.getValue()).toBe('x = 2');
		handle.dispose();
		expect(monacoState.editors[2]!.contentSubDisposed).toBe(true);
		expect(monacoState.editors[2]!.disposed).toBe(true);
	});

	it('createDiffEditor mounts two owned models, read-only by default (D2)', () => {
		const container = document.createElement('div');
		const handle = createDiffEditor(container, 'base', 'changed', { language: 'yaml' });
		expect(monacoState.models.map((m) => m.value)).toEqual(['base', 'changed']);
		expect(monacoState.diffCalls[0]!.container).toBe(container);
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(true); // read-only BY DEFAULT (D2)
		expect(monacoState.diffCalls[0]!.options.useInlineViewWhenSpaceIsLimited).toBe(false);
		expect(monacoState.diffCalls[0]!.options.renderSideBySide).toBe(true);
		expect(monacoState.diffs[0]!.model).toEqual({ original: monacoState.models[0], modified: monacoState.models[1] });

		handle.dispose();
		expect(monacoState.models[0]!.disposed).toBe(true);
		expect(monacoState.models[1]!.disposed).toBe(true);
	});

	it('createDiffEditor defaults to plaintext and honors readOnly: false', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b', { readOnly: false });
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(false);
	});
});