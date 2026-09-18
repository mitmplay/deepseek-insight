/**
 * SuggestStrip tag chips tests (The Prompt Tags ADR 2026-09-14, D10 —
 * Wave 5 task 5.1-T): recTags = deduped first-seen union of the rows
 * prop; chips render AFTER SuggestLine; zero checked renders every row;
 * two checked AND-filter the props LOCALLY (zero network calls); checked
 * state restores from the dsi-strip-tags-filter desk slot after a
 * re-mount (the hard-reload proxy).
 *
 * The strip is presentational: fetch is stubbed and asserted NEVER called
 * by the filtering path (D10's "no refetch" contract).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SuggestStrip from '$lib/components/chat/SuggestStrip.svelte';
import StripTagChips from '$lib/components/chat/StripTagChips.svelte';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger';

function row(id: number, text: string, tags: string, useCount = 1): SuggestedPrompt {
	return { id, label: null, text, use_count: useCount, macro: 0, last_used_at: '2026-09-14 00:00', tags };
}

const rows: SuggestedPrompt[] = [
	row(1, 'commit all and push', 'git rca kb-writer plan session'),
	row(2, 'study the github flow', 'git github'),
	row(3, 'untagged legacy', ''),
	row(4, 'write the postmortem', 'rca kb-writer')
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	setWorkspaceState(null);
	localStorage.clear();
});

interface Mounted {
	target: HTMLElement;
	texts: () => string[];
	cleanup: () => void;
}

function mountStrip(r: SuggestedPrompt[], props: Record<string, unknown> = {}): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SuggestStrip, {
		target,
		props: {
			rows: r,
			onpick: () => {},
			...props
		}
	});
	flushSync();
	return {
		target,
		texts: () => Array.from(target.querySelectorAll('.strip-row-text, [data-testid="suggest-strip"] .strip-chip, [data-testid="suggest-strip"] .strip-tip')).map((e) => e.textContent ?? ''),
		cleanup: () => {
			setWorkspaceState(null);
			unmount(instance);
			target.remove();
		}
	};
}

function chips(target: HTMLElement): HTMLLabelElement[] {
	return Array.from(target.querySelectorAll('.strip-tag-chip'));
}

function chipTexts(target: HTMLElement): string[] {
	return chips(target).map((c) => c.textContent?.trim() ?? '');
}

describe('5.1-T — StripTagChips (D10)', () => {
	it('recTags = deduped FIRST-SEEN union of the rows prop, recomputed on rows change', async () => {
		const h = mountStrip(rows);
		expect(chipTexts(h.target.parentNode as HTMLElement)).toEqual(['git', 'rca', 'kb-writer', 'plan', 'session', 'github']);
		h.cleanup();
	});

	it('chips render AFTER SuggestLine (the manage control)', async () => {
		const h = mountStrip(rows);
		const strip = h.target.querySelector('[data-testid="suggest-strip"]')!;
		const children = Array.from(strip.children).map((c) => c.className);
		const last = children[children.length - 1];
		expect(last).toContain('strip-tag-chips'); // chips are the strip's LAST child
		expect(children.filter((c) => c.includes('suggest-line') || c.includes('strip-chip')).length).toBeGreaterThan(0);
		h.cleanup();
	});

	it('zero checked renders EVERY row', async () => {
		const h = mountStrip(rows);
		const strip = h.target.querySelector('[data-testid="suggest-strip"]')!;
		expect(strip.querySelectorAll('.strip-chip').length).toBe(4);
		h.cleanup();
	});

	it('two checked AND-filter the rows LOCALLY — zero network calls', async () => {
		const h = mountStrip(rows);
		const labels = chips(h.target.parentNode as HTMLElement);
		labels.find((l) => l.textContent?.trim() === 'git')!.querySelector('input')!.click();
		labels.find((l) => l.textContent?.trim() === 'rca')!.querySelector('input')!.click();
		flushSync();
		const strip = document.body.querySelector('[data-testid="suggest-strip"]')!;
		// only row 1 carries BOTH git and rca
		expect(strip.querySelectorAll('.strip-chip')).toHaveLength(1);
		expect(strip.textContent).toContain('commit all and push');
		expect(fetchMock).not.toHaveBeenCalled(); // D10: never a refetch
		h.cleanup();
	});

	it('a checked word absent from recTags persists but filters NOTHING', async () => {
		localStorage.setItem('dsi-strip-tags-filter', JSON.stringify(['plan', 'ghost']));
		const h = mountStrip(rows); // 'ghost' occurs in no row
		const strip = h.target.querySelector('[data-testid="suggest-strip"]')!;
		// 'plan' occurs only in row 1 → AND keeps row 1; 'ghost' filters nothing
		expect(strip.querySelectorAll('.strip-chip')).toHaveLength(1);
		expect(strip.textContent).toContain('commit all and push');
		h.cleanup();
	});

	it('checked state restores from the DEFAULT desk slot after re-mount (hard-reload proxy)', async () => {
		localStorage.setItem('dsi-strip-tags-filter', JSON.stringify(['github']));
		const h = mountStrip(rows);
		const strip = h.target.querySelector('[data-testid="suggest-strip"]')!;
		expect(strip.querySelectorAll('.strip-chip')).toHaveLength(1);
		expect(strip.textContent).toContain('study the github flow');
		const box = chips(h.target.parentNode as HTMLElement).find((l) => l.textContent?.trim() === 'github')!.querySelector('input')!;
		expect(box.checked).toBe(true);
		h.cleanup();
	});

	it('restores from the _widi desk slot when the workspace profile is widi; the default slot is NOT read', async () => {
		localStorage.setItem('dsi-strip-tags-filter', JSON.stringify(['github']));
		localStorage.setItem('dsi-strip-tags-filter_widi', JSON.stringify(['kb-writer']));
		setWorkspaceState({
			rows: [],
			ghosts: [],
			selectedPanelId: null,
			profile: 'widi',
			select: () => {},
			remove: () => {}
		});
		const h = mountStrip(rows);
		const strip = h.target.querySelector('[data-testid="suggest-strip"]')!;
		const texts = Array.from(strip.querySelectorAll('.strip-chip')).map((e) => e.textContent);
		expect(texts.some((t) => t?.includes('write the postmortem'))).toBe(true); // kb-writer rows survive
		expect(texts.some((t) => t?.includes('study the github flow'))).toBe(false); // github filter NOT applied
		h.cleanup();
	});

	it('a toggle persists to the desk slot (write-through)', async () => {
		const h = mountStrip(rows);
		chips(h.target.parentNode as HTMLElement).find((l) => l.textContent?.trim() === 'git')!.querySelector('input')!.click();
		flushSync();
		expect(JSON.parse(localStorage.getItem('dsi-strip-tags-filter')!)).toEqual(['git']);
		h.cleanup();
	});

	it('the pick callback keeps the ORIGINAL rows index while filtered (indices never re-map)', async () => {
		let picked = -1;
		const h = mountStrip(rows, { onpick: (i: number) => (picked = i) });
		// check 'git' + 'github' → only row 2 (index 1) survives
		const labels = chips(h.target.parentNode as HTMLElement);
		labels.find((l) => l.textContent?.trim() === 'git')!.querySelector('input')!.click();
		labels.find((l) => l.textContent?.trim() === 'github')!.querySelector('input')!.click();
		flushSync();
		const strip = document.body.querySelector('[data-testid="suggest-strip"]')!;
		(strip.querySelector('.strip-pick') as HTMLElement).click();
		flushSync();
		expect(picked).toBe(1); // the ORIGINAL index, not the filtered position
		h.cleanup();
	});

	it('empty rows → recTags empty → StripTagChips renders NOTHING (the {#if} false arm)', async () => {
		const h = mountStrip([]);
		expect(document.querySelector('.strip-tag-chips')).toBeNull();
		expect(chips(document.body)).toHaveLength(0);
		h.cleanup();
	});

	// The {#if} false arm is unreachable through SuggestStrip, which gates
	// the whole strip on rows.length > 0 — so the chips never mount empty.
	it('DIRECT mount: recTags = [] renders NOTHING (the {#if} false arm)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(StripTagChips, { target, props: { recTags: [], checked: [], ontoggle: () => {} } });
		flushSync();
		expect(target.querySelector('.strip-tag-chips')).toBeNull();
		expect(target.textContent?.trim()).toBe('');
		unmount(instance);
		target.remove();
	});

	it('DIRECT mount: zero checked → every chip renders without the on class', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(StripTagChips, {
			target,
			props: { recTags: ['git', 'rca'], checked: [], ontoggle: () => {} }
		});
		flushSync();
		const labels = Array.from(target.querySelectorAll('.strip-tag-chip'));
		expect(labels).toHaveLength(2);
		expect(labels.every((l) => !l.classList.contains('on'))).toBe(true);
		expect(labels.every((l) => l.querySelector('input')?.checked === false)).toBe(true);
		unmount(instance);
		target.remove();
	});

	it('chips start UNCHECKED when the filter is empty (class:on false arm)', async () => {
		const h = mountStrip(rows);
		const boxes = chips(h.target.parentNode as HTMLElement).map((l) => l.querySelector('input')!);
		expect(boxes.length).toBeGreaterThan(0);
		expect(boxes.every((b) => !b.checked)).toBe(true);
		// and the unchecked class is absent before any toggle
		expect(chips(h.target.parentNode as HTMLElement).every((c) => !c.classList.contains('on'))).toBe(true);
		h.cleanup();
	});
});
