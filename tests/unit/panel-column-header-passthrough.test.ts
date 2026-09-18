/**
 * PanelColumn unit tests — the header pass-through (the one statement
 * no reduced-suite test reaches: `panelId` is only read when a header
 * ACTION fires, so mounting the column and clicking the chrome is what
 * proves the column threads `panel.id` into the header).
 *
 * Pins:
 *  - a move-chevron click inside the column invokes the registry with
 *    the COLUMN's panel id and the chevron's direction
 *  - the close button fires the column's onremove callback
 *
 * PanelHeader lens mode (The Panel Loupe ADR D8, 2026-09-04) — mounted
 * directly (the loupe's mount shape; PanelColumn gains no lens prop):
 *  - lens: both chevrons present AND disabled regardless of edge, close
 *    present AND disabled even without onremove, copy-id stays enabled
 *  - default (lens false): today's behavior byte-identical — chevrons
 *    follow canMoveLeft/canMoveRight, close enabled
 *  - a disabled close click never invokes onremove (happy-dom swallows
 *    clicks at disabled buttons — the attribute is the contract)
 */

import { flushSync, createRawSnippet } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelColumn from '$lib/components/panels/PanelColumn.svelte';
import PanelHeader from '$lib/components/panels/PanelHeader.svelte';
import { registerMovePanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import type { DsiPanelEntry } from '$lib/types';

function bodySnippet() {
	return createRawSnippet(() => ({ render: () => '<div>panel body</div>' }));
}

function entry(id: string, sessionId: string, width: number): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

function mountColumn(props: { panel?: DsiPanelEntry; canMoveLeft?: boolean; copyValue?: string; onremove?: () => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelColumn, {
		target,
		props: {
			panel: props.panel ?? entry('p1', 's-1', 730),
			index: 0,
			selected: false,
			copyValue: props.copyValue,
			canMoveLeft: props.canMoveLeft ?? true,
			onremove: props.onremove ?? vi.fn(),
			children: bodySnippet()
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
	resetPanelRegistryForTests();
});

describe('PanelColumn — header pass-through', () => {
	it('a move-chevron click inside the column reports the column panel id', () => {
		const moves: Array<[string, string]> = [];
		registerMovePanel((panelId, dir) => moves.push([panelId, dir]));
		const { target, instance } = mountColumn({ panel: entry('p7', 's-seven', 480) });
		(target.querySelector('[data-testid="panel-move-left"]') as HTMLButtonElement).click();
		flushSync();
		expect(moves).toEqual([['p7', 'left']]);
		unmount(instance);
	});

	it('the header close button fires the column onremove callback', () => {
		const removed = vi.fn();
		const { target, instance } = mountColumn({ onremove: removed });
		(target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
		flushSync();
		expect(removed).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('PanelHeader — lens mode (Panel Loupe D8)', () => {
	function mountHeader(props: {
		canMoveLeft?: boolean;
		canMoveRight?: boolean;
		lens?: boolean;
		onremove?: () => void;
	}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PanelHeader, {
			target,
			props: {
				panelId: 'p1',
				sessionId: 's-1',
				canMoveLeft: props.canMoveLeft ?? false,
				canMoveRight: props.canMoveRight ?? false,
				lens: props.lens ?? false,
				onremove: props.onremove
			}
		});
		flushSync();
		return { target, instance };
	}

	const btn = (target: HTMLElement, id: string): HTMLButtonElement | null =>
		target.querySelector(`[data-testid="${id}"]`);

	it('lens: both chevrons render disabled at no edge, close renders disabled without onremove, copy-id stays enabled', () => {
		const { target, instance } = mountHeader({ lens: true });
		const left = btn(target, 'panel-move-left');
		const right = btn(target, 'panel-move-right');
		const close = btn(target, 'panel-close');
		const copy = btn(target, 'panel-header-copy-id');
		expect(left).not.toBeNull();
		expect(right).not.toBeNull();
		expect(close).not.toBeNull(); // rendered whole — the verb is visible
		expect(left?.disabled).toBe(true);
		expect(right?.disabled).toBe(true);
		expect(close?.disabled).toBe(true);
		expect(copy?.disabled).toBe(false); // a surface verb — stays live
		unmount(instance);
	});

	it('default (lens false): chevrons follow the edges, close is enabled — today pinned', () => {
		const { target, instance } = mountHeader({
			canMoveLeft: true,
			onremove: () => {}
		});
		expect(btn(target, 'panel-move-left')).not.toBeNull();
		expect(btn(target, 'panel-move-left')?.disabled).toBe(false);
		expect(btn(target, 'panel-move-right')).toBeNull(); // right edge hides it
		expect(btn(target, 'panel-close')?.disabled).toBe(false);
		unmount(instance);
	});

	it('a disabled close click never invokes onremove', () => {
		const removed = vi.fn();
		const { target, instance } = mountHeader({ lens: true, onremove: removed });
		(btn(target, 'panel-close') as HTMLButtonElement).click();
		flushSync();
		expect(removed).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('PanelColumn — workspace-explorer header (title + copy root)', () => {
	const explorer: DsiPanelEntry = {
		id: 'p9',
		kind: 'workspace-explorer',
		sessionId: 's-1',
		root: '/tmp/dsi-e2e-ws',
		expanded: [],
		width: 730
	};

	it('the column header labels the WORKSPACE NAME under explorer-title', () => {
		const { target, instance } = mountColumn({ panel: explorer });
		expect(
			target.querySelector<HTMLElement>('[data-testid="explorer-title"]')!.textContent?.trim()
		).toBe('dsi-e2e-ws');
		unmount(instance);
	});

	it('the header copy prefix button copies the workspace FULL PATH — "Copy Workspace fullpath"', async () => {
		const writeText = vi.fn<(text: string) => Promise<void>>();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		writeText.mockResolvedValueOnce(undefined);
		const { target, instance } = mountColumn({ panel: explorer });
		const copy = target.querySelector<HTMLButtonElement>('[data-testid="panel-header-copy-id"]')!;
		expect(copy.getAttribute('aria-label')).toBe('Copy Workspace fullpath');
		copy.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(writeText).toHaveBeenCalledWith('/tmp/dsi-e2e-ws');
		unmount(instance);
	});
});

describe('PanelColumn — workspace-file header (title + copy full path)', () => {
	const file: DsiPanelEntry = {
		id: 'p10',
		kind: 'workspace-file',
		sessionId: 's-1',
		path: 'docs/notes.md',
		explorerPanelId: null,
		width: 730
	};

	it('the column header labels the FILE NAME under file-title', () => {
		const { target, instance } = mountColumn({ panel: file });
		expect(
			target.querySelector<HTMLElement>('[data-testid="file-title"]')!.textContent?.trim()
		).toBe('notes.md');
		unmount(instance);
	});

	it('the header copy prefix button copies the COMPOSED full path — "Copy Filename fullpath"', async () => {
		const writeText = vi.fn<(text: string) => Promise<void>>();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});
		writeText.mockResolvedValueOnce(undefined);
		const { target, instance } = mountColumn({
			panel: file,
			copyValue: '/tmp/dsi-e2e-ws/docs/notes.md'
		});
		const copy = target.querySelector<HTMLButtonElement>('[data-testid="panel-header-copy-id"]')!;
		expect(copy.getAttribute('aria-label')).toBe('Copy Filename fullpath');
		copy.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(writeText).toHaveBeenCalledWith('/tmp/dsi-e2e-ws/docs/notes.md');
		unmount(instance);
	});
});
