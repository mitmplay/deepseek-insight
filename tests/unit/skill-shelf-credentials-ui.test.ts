/**
 * 2.2-T — Shelf Credentials UI (ADR 2026-09-22 D4/D5): the group head
 * shows the version tag inside the collapse button and the two door
 * anchors OUTSIDE it; null credentials render nothing; the doors never
 * fold the group and the collapse toggle keeps its contract.
 */
import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsPanelHost from './SettingsSkillsPanelHost.svelte';

function snapshotFor(source: Record<string, unknown>) {
	return {
		ok: true,
		reused: true,
		uninstallable: [],
		snapshot: {
			generatedAt: '2026-09-22T00:00:00Z',
			sources: [
				{
					id: 'pstack',
					author: 'Lauren Tan',
					repo: 'https://github.com/cursor/plugins/tree/main/pstack',
					skills: [
						{ n: '1.1', id: 'sk-one', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }
					],
					...source
				}
			]
		}
	};
}

function jsonRes(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mountPanel(body: Record<string, unknown>): HTMLElement {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonRes(body))));
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsPanelHost, { target });
	flushSync();
	return target;
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('shelf group-head credentials', () => {
	it('renders the version tag (v6.4) inside the button when version present', async () => {
		const target = mountPanel(snapshotFor({ version: '6.4', authorUrl: 'https://www.linkedin.com/in/laurenelizabethtan/' }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		const button = target.querySelector<HTMLButtonElement>('[data-testid="shelf-group-pstack"]')!;
		// group index prefix (registry order, matching the skills' n addressing)
		expect(button.textContent).toContain('1.');
		const tag = target.querySelector('[data-testid="shelf-version-pstack"]')!;
		expect(tag.textContent).toBe('(v6.4)');
		// inside the button — it is text, not a control (D4)
		expect(tag.closest('button')).not.toBeNull();
	});

	it('renders both doors with hrefs and labels, OUTSIDE the collapse button', async () => {
		const target = mountPanel(snapshotFor({ version: '6.4', authorUrl: 'https://www.linkedin.com/in/laurenelizabethtan/' }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-door-repo-pstack"]')).not.toBeNull();
		});
		const repo = target.querySelector<HTMLAnchorElement>('[data-testid="shelf-door-repo-pstack"]')!;
		const author = target.querySelector<HTMLAnchorElement>('[data-testid="shelf-door-author-pstack"]')!;
		expect(repo.getAttribute('href')).toBe('https://github.com/cursor/plugins/tree/main/pstack');
		expect(author.getAttribute('href')).toBe('https://www.linkedin.com/in/laurenelizabethtan/');
		for (const door of [repo, author]) {
			expect(door.getAttribute('target')).toBe('_blank');
			expect(door.getAttribute('rel')).toContain('noopener');
			// structural D4 pin: the door is NOT nested in the collapse button
			expect(door.closest('button')).toBeNull();
			// labels come from the i18n catalogs, not hardcoded copies
			expect(door.getAttribute('aria-label')!.length).toBeGreaterThan(0);
		}
	});

	it('clicking a door does NOT fold the group; the button still toggles', async () => {
		const target = mountPanel(snapshotFor({ version: '6.4', authorUrl: 'https://www.linkedin.com/in/laurenelizabethtan/' }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		const button = target.querySelector<HTMLButtonElement>('[data-testid="shelf-group-pstack"]')!;
		// expand first
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		const expandedBefore = button.getAttribute('aria-expanded');
		// door click: dispatch without navigation (defaultPrevented-safe)
		const door = target.querySelector<HTMLAnchorElement>('[data-testid="shelf-door-repo-pstack"]')!;
		door.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		flushSync();
		expect(button.getAttribute('aria-expanded')).toBe(expandedBefore);
		// the collapse button itself still toggles
		button.click();
		flushSync();
		expect(button.getAttribute('aria-expanded')).not.toBe(expandedBefore);
	});

	it('null credentials degrade to invisible: no tag, no doors (D5)', async () => {
		const target = mountPanel(snapshotFor({ version: null, authorUrl: null }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		expect(target.querySelector('[data-testid="shelf-version-pstack"]')).toBeNull();
		expect(target.querySelector('[data-testid="shelf-door-author-pstack"]')).toBeNull();
		// the repo itself exists — its door stays (D5 omits it only when repo is null)
		expect(target.querySelector('[data-testid="shelf-door-repo-pstack"]')).not.toBeNull();
	});

	it('null repo renders no repo door (source-no-repo degradation)', async () => {
		const target = mountPanel(snapshotFor({ version: null, authorUrl: null, repo: null }));
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		expect(target.querySelector('[data-testid="shelf-door-repo-pstack"]')).toBeNull();
	});
});
