/**
 * tool-preview — peek-list args preview tests (OCI extractArgsPreview port).
 *
 * Pins the DSH arg shapes the peek list reads: path/cmd/pattern/query/url
 * ladders, non-JSON raw fallback with 120-char cap, empty/undefined honesty.
 */
import { describe, expect, it } from 'vitest';
import { extractArgsPreview } from '$lib/utils/tool-preview';

describe('extractArgsPreview (ToolPeekButton port)', () => {
	it('path ladder first: read args render the path', () => {
		expect(extractArgsPreview('read', '{"path":"/tmp/dsh/main.py"}')).toBe('/tmp/dsh/main.py');
	});

	it('cmd beats pattern: bash args render the command', () => {
		expect(extractArgsPreview('bash', '{"cmd":"echo parity-check"}')).toBe('echo parity-check');
	});

	it('grep args render the pattern', () => {
		expect(extractArgsPreview('grep', '{"pattern":"glm-5","path":"/tmp/dsh"}')).toBe('/tmp/dsh');
	});

	it('query and url ladders', () => {
		expect(extractArgsPreview('web_search', '{"query":"dsh ledger"}')).toBe('dsh ledger');
		expect(extractArgsPreview('web_fetch', '{"url":"https://example.com"}')).toBe('https://example.com');
	});

	it('non-JSON falls back to raw, truncated at 120 chars', () => {
		const raw = 'x'.repeat(200);
		const out = extractArgsPreview('bash', raw);
		expect(out.length).toBe(121);
		expect(out.endsWith('…')).toBe(true);
	});

	it('empty args render empty — the peek row stays name-only', () => {
		expect(extractArgsPreview('bash', undefined)).toBe('');
		expect(extractArgsPreview('bash', '')).toBe('');
	});

	it('command ladder (pwsh-style args) renders the command', () => {
		expect(extractArgsPreview('pwsh', '{"command":"Get-ChildItem"}')).toBe('Get-ChildItem');
	});

	it('input.path (nested agent args) renders the inner path', () => {
		expect(extractArgsPreview('agent', '{"input":{"path":"/tmp/inner.ts"}}')).toBe('/tmp/inner.ts');
	});

	it('input that is NOT an object skips to the first-string ladder', () => {
		// input: 'ssh' is a string, not {path} — the nested branch declines,
		// the first-string value wins.
		expect(extractArgsPreview('tool', '{"input":"ssh","note":"fallback"}')).toBe('ssh');
	});

	it('no known key falls back to the FIRST string value', () => {
		expect(extractArgsPreview('custom', '{"count":3,"hint":"first-string"}')).toBe('first-string');
	});

	it('object-only args with no string values fall back to raw JSON', () => {
		const raw = '{"a":{"b":1}}';
		expect(extractArgsPreview('custom', raw)).toBe(raw);
	});
});
