/**
 * manager-embed tests (W4 task 4.1-T): PromptManagerPanel's EMBEDDED
 * host shape (ADR "The Manager in the Panel" D3/D8) — root-scoped
 * Escape, portaled edit pair, modal defaults untouched.
 *
 * Mounts the panel directly (the embedded host's shape) with a fetch
 * stub — the HTTP contract is the only boundary (db.ts never imported).
 */
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptManagerPanel from '$lib/components/chat/PromptManagerPanel.svelte';

interface Row {
	id: number;
	label: string | null;
	text: string;
	use_count: number;
	last_used_at: string;
}

const rows: Row[] = [
	{ id: 1, label: 'feature-spec', text: 'write the feature spec', use_count: 100, last_used_at: '2026-09-06 09:00' },
	{ id: 2, label: null, text: 'commit all and push', use_count: 73, last_used_at: '2026-09-05 08:00' }
];

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?')) {
				return new Response(JSON.stringify({ rows, total: rows.length }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({}), { status: 404 });
		})
	);
}

function managerRoot(target: HTMLElement): HTMLElement {
	const root = target.querySelector('.mgr-panel-root') as HTMLElement | null;
	expect(root).not.toBeNull();
	return root!;
}

async function wait(ms = 30): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

function esc(node: HTMLElement): void {
	node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PromptManagerPanel — embedded host (W4 4.1-T)', () => {
	it('root-scoped Escape closes exactly ONE of two mounted managers (D3)', async () => {
		installFetch();
		const closed: string[] = [];
		const mk = (tag: string): { target: HTMLElement; instance: ReturnType<typeof mount> } => {
			const target = document.createElement('div');
			document.body.appendChild(target);
			const instance = mount(PromptManagerPanel, {
				target,
				props: {
					onclose: () => closed.push(tag),
					escapeScope: 'root',
					host: 'panel'
				}
			});
			return { target, instance };
		};
		const a = mk('a');
		const b = mk('b');
		await wait();
		// Escape lands on A's own root — B never hears it.
		esc(managerRoot(a.target));
		expect(closed).toEqual(['a']);
		// B is still live; its own root closes it.
		esc(managerRoot(b.target));
		expect(closed).toEqual(['a', 'b']);
		unmount(a.instance);
		unmount(b.instance);
	});

	it('window scope stays the DEFAULT: a bare mount closes on window Escape (modal shape)', async () => {
		installFetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let closed = 0;
		const instance = mount(PromptManagerPanel, {
			target,
			props: { onclose: () => (closed += 1) }
		});
		await wait();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(closed).toBe(1);
		unmount(instance);
	});

	it('the edit pair portals to document.body while the table stays in-column (BC-7)', async () => {
		installFetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PromptManagerPanel, {
			target,
			props: { onclose: () => {}, escapeScope: 'root', host: 'panel' }
		});
		await wait();
		// The Prompt Tags D9: the ROW is the edit affordance — the per-row
		// Edit button is gone; a body-row click opens the dialog.
		const firstRow = target.querySelector('tbody tr:not(.mgr-editing)') as HTMLElement;
		expect(firstRow).not.toBeNull();
		firstRow.click();
		await wait();
		// Table (and the highlighted source row) stays inside the column.
		expect(target.querySelector('.mgr-body-table')).not.toBeNull();
		// The portaled pair lives under document.body, outside the column.
		const portalHost = document.body.querySelector('.mgr-edit-portal') as HTMLElement | null;
		expect(portalHost).not.toBeNull();
		expect(portalHost!.parentElement).toBe(document.body);
		expect(portalHost!.querySelector('.mgr-edit-dialog')).not.toBeNull();
		expect(portalHost!.querySelector('.mgr-edit-backdrop')).not.toBeNull();
		// Cancel unwraps: the pair leaves body with the {#if}.
		(portalHost!.querySelector('.mgr-btn-cancel') as HTMLButtonElement).click();
		await wait();
		expect(document.body.querySelector('.mgr-edit-portal')).toBeNull();
		unmount(instance);
	});

	it('Escape with the edit dialog open does NOT close the manager (sub-form keeps its text)', async () => {
		installFetch();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let closed = 0;
		const instance = mount(PromptManagerPanel, {
			target,
			props: { onclose: () => (closed += 1), escapeScope: 'root', host: 'panel' }
		});
		await wait();
		(target.querySelector('tbody tr:not(.mgr-editing)') as HTMLElement).click();
		await wait();
		esc(managerRoot(target));
		expect(closed).toBe(0);
		expect(document.body.querySelector('.mgr-edit-dialog')).not.toBeNull();
		unmount(instance);
	});
});
