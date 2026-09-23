// @vitest-environment happy-dom
/**
 * ContextSnapshotBody unit tests (Section Split wave 2, task 2.1-T):
 * parsed sections render caption + one text-node block per section;
 * malformed or absent sections fall back to the markdown body — the
 * fallback must be byte-equivalent to the pre-split chip's body.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import ContextSnapshotBody from '$lib/components/message/ContextSnapshotBody.svelte';

const TEXT = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: danger-full-access.\n\nApproval prompts are disabled in this session.';

const SECTIONS_SOURCE = {
	kind: 'plugin',
	plugin: '@deepseek-ai/dsh-system-prompt',
	form: 'snapshot',
	sections: [
		{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
		{ name: 'approval:policy', text: 'Approval prompts are disabled in this session.' }
	]
};

function mountBody(props: { text: string; metaSource?: Record<string, unknown> }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ContextSnapshotBody, { target, props });
	flushSync();
	return { target, cleanup: () => unmount(instance) };
}

describe('ContextSnapshotBody', () => {
	it('renders the supersedes caption plus one block per section', () => {
		const { target, cleanup } = mountBody({ text: TEXT, metaSource: SECTIONS_SOURCE });
		expect(target.querySelector('[data-testid="context-snapshot-supersedes"]')).not.toBeNull();
		const blocks = target.querySelectorAll('[data-testid="context-section"]');
		expect(blocks).toHaveLength(2);
		expect(blocks[0]!.textContent).toContain('sandbox:policy');
		expect(blocks[0]!.textContent).toContain('danger-full-access');
		expect(blocks[1]!.textContent).toContain('approval:policy');
		cleanup();
	});

	it('renders section text as literal text — markdown syntax stays raw (BC-12)', () => {
		const source = { ...SECTIONS_SOURCE, sections: [{ name: 'x:policy', text: '**not bold** <script>1</script>' }] };
		const { target, cleanup } = mountBody({ text: TEXT, metaSource: source as Record<string, unknown> });
		expect(target.querySelector('strong')).toBeNull();
		expect(target.querySelector('script')).toBeNull();
		expect(target.textContent).toContain('**not bold**');
		expect(target.textContent).toContain('<script>1</script>');
		cleanup();
	});

	it.each([
		['malformed sections', { sections: ['env'] }],
		['absent sections', { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' }],
		['undefined metaSource', undefined]
	])('falls back to the markdown body on %s', (_label, metaSource) => {
		const { target, cleanup } = mountBody({ text: TEXT, metaSource: metaSource as Record<string, unknown> | undefined });
		expect(target.querySelector('[data-testid="context-snapshot-supersedes"]')).toBeNull();
		expect(target.querySelector('[data-testid="context-sections"]')).toBeNull();
		// Fallback body = the joined text (MarkdownContent renders it).
		expect(target.textContent).toContain('Current runtime context.');
		cleanup();
	});
});
