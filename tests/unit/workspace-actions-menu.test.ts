/**
 * WorkspaceActionsMenu unit tests (Chip Menu ADR D2, task 4.1-T): pins
 * the three faces (menu rows, rename editor, delete confirm), the
 * trim-empty disable, the honest cost copy, the ok-closes contract, and
 * inline refusal rendering. fetch is stubbed — the menu owns no wire
 * code beyond the route call (BC-1).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceActionsMenu from '$lib/components/sessions/WorkspaceActionsMenu.svelte';

function mountMenu(overrides: Partial<{ workspaceId: string; currentTitle: string }> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclose = vi.fn();
	const instance = mount(WorkspaceActionsMenu, {
		target,
		props: { workspaceId: 'ws-1', currentTitle: 'Harness', onclose, ...overrides }
	});
	flushSync();
	return { target, instance, onclose };
}

const row = (target: HTMLElement, testid: string): HTMLButtonElement =>
	target.querySelector('[data-testid="' + testid + '"]') as HTMLButtonElement;

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('WorkspaceActionsMenu — menu face', () => {
	it('renders Rename and Delete rows (delete present, danger class)', () => {
		const { target, instance } = mountMenu();
		expect(row(target, 'workspace-action-rename')).not.toBeNull();
		const del = row(target, 'workspace-action-delete');
		expect(del.className).toContain('danger');
		unmount(instance);
	});
});

describe('WorkspaceActionsMenu — rename face', () => {
	it('seeds the input with the current title and disables confirm on trim-empty (ADR D2)', async () => {
		const { target, instance } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		const input = target.querySelector('[data-testid="workspace-rename-input"]') as HTMLInputElement;
		expect(input.value).toBe('Harness');
		const confirm = row(target, 'workspace-rename-confirm');
		expect(confirm.disabled).toBe(false);
		input.value = '   ';
		input.dispatchEvent(new Event('input'));
		await flushSync();
		expect(row(target, 'workspace-rename-confirm').disabled).toBe(true);
		unmount(instance);
	});

	it('ok response closes (no optimistic label change — settle owns the screen, ADR D6)', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, workspace: {} }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		const input = target.querySelector('[data-testid="workspace-rename-input"]') as HTMLInputElement;
		input.value = '  Renamed Home  ';
		input.dispatchEvent(new Event('input'));
		await flushSync();
		row(target, 'workspace-rename-confirm').click();
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/dsh/workspaces/ws-1/rename');
		// The wire gets the TRIMMED title (route contract).
		expect(JSON.parse(String(init.body))).toEqual({ title: 'Renamed Home' });
		unmount(instance);
	});

	it('refusal renders inline, code verbatim, menu stays open', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(
			JSON.stringify({ ok: false, error: { code: 'workspace/name-conflict', message: 'title taken' } }),
			{ status: 502 }
		)));
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		row(target, 'workspace-rename-confirm').click();
		await vi.waitFor(() =>
			expect(target.querySelector('[data-testid="workspace-menu-error"]')?.textContent)
				.toContain('workspace/name-conflict')
		);
		expect(onclose).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('WorkspaceActionsMenu — delete face', () => {
	it('shows the honest cost copy before the click is spent (ADR D2)', async () => {
		const { target, instance } = mountMenu();
		row(target, 'workspace-action-delete').click();
		await flushSync();
		const cost = target.querySelector('[data-testid="workspace-delete-cost"]');
		expect(cost?.textContent).toContain('sessions stay');
		expect(cost?.textContent).toContain('grey');
		unmount(instance);
	});

	it('confirm POSTs the delete route with no body and closes on ok', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, workspaceId: 'ws-1' }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-delete').click();
		await flushSync();
		row(target, 'workspace-delete-confirm').click();
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/dsh/workspaces/ws-1/delete');
		expect(init.body).toBeUndefined();
		unmount(instance);
	});
});

describe('WorkspaceActionsMenu — dismissal', () => {
	it('Escape closes', async () => {
		const { instance, onclose } = mountMenu();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await flushSync();
		expect(onclose).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('outside pointerdown closes', async () => {
		const { instance, onclose } = mountMenu();
		document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		await flushSync();
		expect(onclose).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('pointerdown inside the menu does NOT close', async () => {
		const { target, instance, onclose } = mountMenu();
		(target.querySelector('[data-testid="workspace-action-rename"]') as HTMLElement)
			.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		await flushSync();
		expect(onclose).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('non-Escape keys do not close', async () => {
		const { instance, onclose } = mountMenu();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await flushSync();
		expect(onclose).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('WorkspaceActionsMenu — inline navigation', () => {
	it('rename face Cancel returns to the menu rows', async () => {
		const { target, instance } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		row(target, 'workspace-rename-cancel').click();
		await flushSync();
		expect(row(target, 'workspace-action-rename')).not.toBeNull();
		unmount(instance);
	});

	it('delete face Cancel returns to the menu rows', async () => {
		const { target, instance } = mountMenu();
		row(target, 'workspace-action-delete').click();
		await flushSync();
		row(target, 'workspace-delete-cancel').click();
		await flushSync();
		expect(row(target, 'workspace-action-delete')).not.toBeNull();
		unmount(instance);
	});

	it('Enter key in the rename input confirms (route called with the trimmed draft)', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		const input = target.querySelector('[data-testid="workspace-rename-input"]') as HTMLInputElement;
		input.value = '  keyed  ';
		input.dispatchEvent(new Event('input'));
		await flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/dsh/workspaces/ws-1/rename');
		expect(JSON.parse(String(init.body))).toEqual({ title: 'keyed' });
		unmount(instance);
	});

	it('Enter with a trim-empty draft is a no-op (the disabled affordance branch)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { target, instance } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		const input = target.querySelector('[data-testid="workspace-rename-input"]') as HTMLInputElement;
		input.value = '   ';
		input.dispatchEvent(new Event('input'));
		await flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await flushSync();
		expect(fetchMock).not.toHaveBeenCalled();
		unmount(instance);
	});
});

describe('WorkspaceActionsMenu — transport refusals', () => {
	it('refusal WITHOUT an error payload falls back to the unknown code', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })));
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-rename').click();
		await flushSync();
		row(target, 'workspace-rename-confirm').click();
		await vi.waitFor(() =>
			expect(target.querySelector('[data-testid="workspace-menu-error"]')?.textContent)
				.toContain('unknown — the request failed')
		);
		expect(onclose).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('network failure (fetch throws) renders the network code, menu stays open', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch'); }));
		const { target, instance, onclose } = mountMenu();
		row(target, 'workspace-action-delete').click();
		await flushSync();
		row(target, 'workspace-delete-confirm').click();
		await vi.waitFor(() =>
			expect(target.querySelector('[data-testid="workspace-menu-error"]')?.textContent)
				.toContain('network — could not reach the host')
		);
		expect(onclose).not.toHaveBeenCalled();
		// The busy flag reset — the confirm row is enabled again.
		expect((row(target, 'workspace-delete-confirm') as HTMLButtonElement).disabled).toBe(false);
		unmount(instance);
	});
});