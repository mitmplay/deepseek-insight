/**
 * PromptManagerTDLabel unit tests — the manager's text cell: label line
 * shown/hidden by nullish label, norm-mode preview (first non-empty line
 * of TEXT only, never the label) + the multiline ⏎ badge, and pre-mode
 * raw-text rendering with no badge.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PromptManagerTDLabel from '$lib/components/prompt-manager/PromptManagerTDLabel.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

function row(overrides: Partial<SuggestedPrompt> = {}): SuggestedPrompt {
	return {
		id: 1,
		label: null,
		text: 'load the spec',
		use_count: 0,
		macro: 0,
		last_used_at: '2026-01-01T00:00:00Z',
		tags: '',
		...overrides
	};
}

function mountCell(r: SuggestedPrompt, textMode: 'norm' | 'pre' = 'norm') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PromptManagerTDLabel, { target, props: { row: r, textMode } });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PromptManagerTDLabel — label line', () => {
	it('a labeled row renders the label tag above the preview', () => {
		const { target, instance } = mountCell(row({ label: 'load-spec', text: 'first\nsecond line' }));
		const tag = target.querySelector('.mgr-label-tag');
		expect(tag?.textContent).toBe('load-spec');
		// preview is TEXT-first, never the label
		expect(target.querySelector('.mgr-preview')?.textContent).toBe('first');
		unmount(instance);
	});

	it('a null label hides the tag entirely — text is the only line', () => {
		const { target, instance } = mountCell(row({ label: null }));
		expect(target.querySelector('.mgr-label-tag')).toBeNull();
		expect(target.querySelector('.mgr-preview')?.textContent).toBe('load the spec');
		unmount(instance);
	});

	it('an empty-string label hides the tag too', () => {
		const { target, instance } = mountCell(row({ label: '' }));
		expect(target.querySelector('.mgr-label-tag')).toBeNull();
		unmount(instance);
	});
});

describe('PromptManagerTDLabel — norm mode', () => {
	it('multiline text previews its first non-empty line and shows the badge', () => {
		const { target, instance } = mountCell(row({ text: '\n  first line\nsecond' }));
		expect(target.querySelector('.mgr-preview')?.textContent).toBe('  first line');
		expect(target.querySelector('.mgr-ml')?.textContent).toBe('⏎');
		unmount(instance);
	});

	it('single-line text carries no badge', () => {
		const { target, instance } = mountCell(row({ text: 'one line only' }));
		expect(target.querySelector('.mgr-ml')).toBeNull();
		expect(target.querySelector('.mgr-preview')?.textContent).toBe('one line only');
		unmount(instance);
	});
});

describe('PromptManagerTDLabel — pre mode', () => {
	it('renders the raw text verbatim with no preview and no badge', () => {
		const { target, instance } = mountCell(row({ label: 'macro', text: 'line1\n  line2\t\nline3' }), 'pre');
		const pre = target.querySelector('.mgr-pre');
		expect(pre?.textContent).toBe('line1\n  line2\t\nline3');
		expect(target.querySelector('.mgr-preview')).toBeNull();
		expect(target.querySelector('.mgr-ml')).toBeNull();
		expect(target.querySelector('.mgr-label-tag')?.textContent).toBe('macro');
		unmount(instance);
	});

	it('defaults to norm mode when textMode is omitted', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PromptManagerTDLabel, { target, props: { row: row() } });
		flushSync();
		expect(target.querySelector('.mgr-preview')).not.toBeNull();
		expect(target.querySelector('.mgr-pre')).toBeNull();
		unmount(instance);
	});
});
