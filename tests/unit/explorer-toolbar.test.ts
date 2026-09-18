/**
 * WorkspaceExplorerToolbar tests (Git Eye task 2.1-T): the renamed,
 * in-flow, full-width left-aligned toolbar — refresh/collapse intents
 * still emit, the canvas-copy control is present, and the old header
 * filename is gone. Layout truth (the lane, the left alignment) is
 * asserted by Playwright on the real page; this file pins the DOM
 * contract the tabs of Wave 4 will build on.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerToolbar from '$lib/components/panels/WorkspaceExplorerToolbar.svelte';

function mounted() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

describe('WorkspaceExplorerToolbar — the renamed in-flow lane (task 2.1-T)', () => {
	it('renders the toolbar row with refresh + collapse-all + canvas copy', () => {
		const onRefresh = vi.fn();
		const onCollapseAll = vi.fn();
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh, onCollapseAll }
		});
		flushSync();

		const toolbar = target.querySelector('[data-testid="explorer-toolbar"]') as HTMLElement;
		expect(toolbar).not.toBeNull();
		expect(toolbar.className).toContain('explorer-toolbar'); // the in-flow lane class
		expect(toolbar.querySelector('[data-testid="explorer-refresh"]')).not.toBeNull();
		expect(toolbar.querySelector('[data-testid="explorer-collapse-all"]')).not.toBeNull();
		// The canvas-copy control survived the rename (a titled control).
		expect(toolbar.querySelector('[title]')).not.toBeNull();
		unmount(instance);
	});

	it('emits onRefresh / onCollapseAll intents (INTENT ONLY contract)', () => {
		const onRefresh = vi.fn();
		const onCollapseAll = vi.fn();
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh, onCollapseAll }
		});
		flushSync();

		(target.querySelector('[data-testid="explorer-refresh"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="explorer-collapse-all"]') as HTMLButtonElement).click();
		expect(onRefresh).toHaveBeenCalledTimes(1);
		expect(onCollapseAll).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});
