/**
 * file-diff-editor tests (File Eye task 3.1-T): the diff factory rides
 * the SAME monaco module as the text editor; here the contract is the
 * factory's OWN shape — readOnly, side-by-side, model ownership, and a
 * dispose that releases both models and the editor.
 */
import { describe, expect, it, vi } from 'vitest';

const calls: Array<{ kind: string; args: unknown[] }> = [];
const disposed: string[] = [];
const sequence: string[] = [];

vi.mock('./settings-editor-worker?worker', () => ({ default: class {} }));
vi.mock('./settings-ts-worker?worker', () => ({ default: class {} }));
vi.mock('./settings-css-worker?worker', () => ({ default: class {} }));
vi.mock('./settings-html-worker?worker', () => ({ default: class {} }));
vi.mock('./settings-json-worker?worker', () => ({ default: class {} }));
vi.mock('monaco-yaml/yaml.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));

vi.mock('monaco-editor', () => ({
	editor: {
		createDiffEditor: (_c: HTMLElement, opts: { readOnly?: boolean; renderSideBySide?: boolean }) => {
			calls.push({ kind: 'createDiffEditor', args: [opts] });
			return {
				setModel: vi.fn((m: { original: object; modified: object } | null) => {
					calls.push({ kind: 'setModel', args: [m] });
					if (m === null) sequence.push('widget-released');
				}),
				dispose: () => { disposed.push('editor'); sequence.push('editor'); }
			};
		},
		createModel: (text: string, language?: string) => {
			calls.push({ kind: 'createModel', args: [text, language] });
			return { text, language, dispose: () => { disposed.push('model:' + text); sequence.push('model:' + text); } };
		}
	}
}));

import { createDiffEditor } from '$lib/components/panels/settings-monaco';

describe('createDiffEditor — the File Eye diff surface (3.1-T)', () => {
	it('renders side-by-side, READ-ONLY, with both models', () => {
		const host = document.createElement('div');
		const handle = createDiffEditor(host, 'before\n', 'after\n', { language: 'typescript' });
		const create = calls.find((c) => c.kind === 'createDiffEditor');
		expect(create).toBeTruthy();
		const opts = create!.args[0] as { readOnly: boolean; renderSideBySide: boolean };
		expect(opts.readOnly).toBe(true);
		expect(opts.renderSideBySide).toBe(true);
		const set = calls.find((c) => c.kind === 'setModel');
		const models = set!.args[0] as { original: { text: string }; modified: { text: string } };
		expect(models.original.text).toBe('before\n');
		expect(models.modified.text).toBe('after\n');
		handle.dispose();
		expect(disposed).toContain('editor');
		expect(disposed).toContain('model:before\n');
		expect(disposed).toContain('model:after\n');
		// The widget RELEASES its models before they die — disposing a
		// TextModel the widget still references throws (monaco 0.56 guard).
		expect(sequence.indexOf('widget-released')).toBeGreaterThanOrEqual(0);
		expect(sequence.indexOf('widget-released')).toBeLessThan(sequence.indexOf('model:before\n'));
	});
});
