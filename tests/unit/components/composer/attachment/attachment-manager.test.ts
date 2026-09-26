/**
 * AttachmentManager (task 1.3-T): accept attribute, drag depth counting,
 * paste filtering, disabled gating, and the drafts bindable mirror.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentManager from '$lib/components/composer/attachment/AttachmentManager.svelte';
import { IMAGE_MEDIA_TYPES, type AttachmentDraft } from '$lib/services/chat/attachment-service.svelte';

const createSpy = vi.fn((_: File) => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

afterEach(() => {
	createSpy.mockClear();
	revokeSpy.mockClear();
});

/** The AttachmentManager export face (Svelte 5 mount returns exports). */
interface ManagerExports {
	clear(): void;
	removeAttachment(id: string): void;
	serialize(ids?: string[]): Promise<unknown>;
	handlePaste(e: ClipboardEvent): void;
}

interface Harness {
	target: HTMLElement;
	mgr: ManagerExports;
	drafts: { value: AttachmentDraft[] };
	cleanup(): void;
}

function mountManager(props: Record<string, unknown> = {}): Harness {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const drafts = { value: [] as AttachmentDraft[] };
	// Two-way binding in mount() rides an accessor prop (getter/setter pair).
	const mgr = mount(AttachmentManager, {
		target,
		props: {
			get drafts() {
				return drafts.value;
			},
			set drafts(v: AttachmentDraft[]) {
				drafts.value = v;
			},
			...props
		}
	}) as unknown as ManagerExports;
	flushSync(); // register document listeners before any event dispatch
	return { target, mgr, drafts, cleanup: () => { unmount(mgr); target.remove(); } };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function png(name: string): File {
	return new File([new Uint8Array(4).fill(0x89)], name, { type: 'image/png' });
}

/** DragEvent stand-in carrying a minimal dataTransfer (happy-dom has none). */
function dragEvent(type: string, files: File[] = []): Event {
	const ev = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'dataTransfer', {
		value: { types: ['Files'], files, dropEffect: 'none' }
	});
	return ev;
}

describe('AttachmentManager — picker', () => {
	it('hidden input accepts exactly the whitelisted media types, multiple', () => {
		const h = mountManager();
		const input = h.target.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
		expect(input.multiple).toBe(true);
		expect(input.accept).toBe(IMAGE_MEDIA_TYPES.join(','));
		h.cleanup();
	});

	it('attach button is disabled while the composer is locked', () => {
		const h = mountManager({ disabled: true });
		const btn = h.target.querySelector('[data-testid="attach-button"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		h.cleanup();
	});
});

describe('AttachmentManager — drag depth counting', () => {
	it('nested enter/leave pairs keep the overlay; depth zero hides it; drop admits files', async () => {
		const h = mountManager();
		document.dispatchEvent(dragEvent('dragenter'));
		document.dispatchEvent(dragEvent('dragenter'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull();
		document.dispatchEvent(dragEvent('dragleave'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull(); // still depth 1
		document.dispatchEvent(dragEvent('dragleave'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull(); // depth 0
		document.dispatchEvent(dragEvent('dragenter'));
		document.dispatchEvent(dragEvent('drop', [png('dropped.png')]));
		await settle();
		expect(h.drafts.value.map((d) => d.file.name)).toEqual(['dropped.png']);
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull(); // drop resets
		h.cleanup();
	});

	it('drags without files never raise the overlay', async () => {
		const h = mountManager();
		const ev = new Event('dragenter', { bubbles: true });
		Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/uri-list'], files: [] } });
		document.dispatchEvent(ev);
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull();
		h.cleanup();
	});
});

describe('AttachmentManager — paste and lifecycle exports', () => {
	it('paste admits only image items and preventDefaults when one exists', async () => {
		const h = mountManager();
		const preventDefault = vi.fn();
		const items = [
			{ type: 'text/plain', getAsFile: () => null },
			{ type: 'image/png', getAsFile: () => png('pasted.png') }
		];
		h.mgr.handlePaste({ preventDefault, clipboardData: { items } } as unknown as ClipboardEvent);
		await settle(); // the bindable mirror flushes through $effect
		expect(h.drafts.value.map((d) => d.file.name)).toEqual(['pasted.png']);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('paste without image items is a pass-through (no preventDefault)', () => {
		const h = mountManager();
		const preventDefault = vi.fn();
		h.mgr.handlePaste({ preventDefault, clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] } } as unknown as ClipboardEvent);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(h.drafts.value).toHaveLength(0);
		h.cleanup();
	});

	it('unsupported admission surfaces a role=alert note; clear/removeAttachment drive the service', async () => {
		const h = mountManager();
		h.mgr.handlePaste({
			preventDefault: () => {},
			clipboardData: { items: [{ type: 'image/tiff', getAsFile: () => new File([], 'x.tiff', { type: 'image/tiff' }) }] }
		} as unknown as ClipboardEvent);
		await settle();
		expect(h.target.querySelector('[data-testid="attach-note"]')?.textContent).toContain('image/tiff');
		h.mgr.clear();
		h.mgr.removeAttachment('unknown-id'); // no-op, must not throw
		await settle();
		expect(h.drafts.value).toHaveLength(0);
		h.cleanup();
	});
});

// ── Coverage extension (2026-08-26): picker click-through, the file
//    input's change lane, note-timer reset/dismiss, dragover effects,
//    no-file drag guards, dragend reset, and the default drafts prop. ──

/** DragEvent stand-in whose dataTransfer types do NOT carry files. */
function nonFileDrag(type: string): Event {
	const ev = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
	return ev;
}

describe('AttachmentManager — picker click and file input change', () => {
	it('mounts with no props — drafts default to the owned empty list, input still wired', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(AttachmentManager, { target });
		flushSync();
		expect(target.querySelector('[data-testid="attach-input"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="attach-button"]')).not.toBeNull();
		unmount(comp);
		target.remove();
	});

	it('the paperclip clicks the hidden input (picker open path)', () => {
		const h = mountManager();
		const input = h.target.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
		const inputClicks: number[] = [];
		input.addEventListener('click', () => inputClicks.push(1));
		(h.target.querySelector('[data-testid="attach-button"]') as HTMLButtonElement).click();
		expect(inputClicks).toHaveLength(1);
		h.cleanup();
	});

	it('a change event with a stubbed FileList admits the files and resets the input value', async () => {
		const h = mountManager();
		const input = h.target.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [png('picked-a.png'), png('picked-b.png')], configurable: true });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(h.drafts.value.map((d) => d.file.name)).toEqual(['picked-a.png', 'picked-b.png']);
		// The handler always resets the input so the same file can be repicked.
		expect(input.value).toBe('');
		h.cleanup();
	});

	it('a change with no files selected admits nothing (empty FileList guard)', async () => {
		const h = mountManager();
		const input = h.target.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [], configurable: true });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(h.drafts.value).toHaveLength(0);
		h.cleanup();
	});
});

describe('AttachmentManager — admission note lifecycle (timer reset + dismiss)', () => {
	it('a repeat failure resets the 5s timer; the note dismisses when it finally fires', async () => {
		vi.useFakeTimers();
		try {
			const h = mountManager();
			const badPaste = () =>
				h.mgr.handlePaste({
					preventDefault: () => {},
					clipboardData: {
						items: [{ type: 'image/tiff', getAsFile: () => new File([], 'x.tiff', { type: 'image/tiff' }) }]
					}
				} as unknown as ClipboardEvent);
			badPaste();
			await settle();
			expect(h.target.querySelector('[data-testid="attach-note"]')).not.toBeNull();
			// Second failure within the window: the first timer is cleared and
			// replaced — the note must NOT dismiss at the old deadline.
			vi.advanceTimersByTime(4_900);
			badPaste();
			await settle();
			vi.advanceTimersByTime(4_900);
			flushSync();
			expect(h.target.querySelector('[data-testid="attach-note"]')).not.toBeNull();
			// The replacement timer fires and the note goes.
			vi.advanceTimersByTime(200);
			flushSync();
			expect(h.target.querySelector('[data-testid="attach-note"]')).toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('AttachmentManager — dragover/dragleave/drop/dragend edges', () => {
	it('dragover with files sets dropEffect copy (none while disabled)', () => {
		const h = mountManager();
		const ev = dragEvent('dragover') as Event & { dataTransfer: { dropEffect: string } };
		document.dispatchEvent(ev);
		expect(ev.dataTransfer.dropEffect).toBe('copy');
		h.cleanup();

		const locked = mountManager({ disabled: true });
		const ev2 = dragEvent('dragover') as Event & { dataTransfer: { dropEffect: string } };
		document.dispatchEvent(ev2);
		expect(ev2.dataTransfer.dropEffect).toBe('none');
		locked.cleanup();
	});

	it('dragover/dragleave/drop without files are ignored entirely', async () => {
		const h = mountManager();
		document.dispatchEvent(dragEvent('dragenter'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull();
		// Non-file dragover: the handler returns before touching dropEffect.
		const nfOver = new Event('dragover', { bubbles: true, cancelable: true });
		Object.defineProperty(nfOver, 'dataTransfer', {
			value: { types: ['text/plain'], files: [], dropEffect: 'untouched' }
		});
		document.dispatchEvent(nfOver);
		expect((nfOver as Event & { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe(
			'untouched'
		);
		// Non-file dragleave: depth does NOT drain.
		document.dispatchEvent(nonFileDrag('dragleave'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull();
		// Non-file drop: overlay stands, nothing admitted.
		document.dispatchEvent(nonFileDrag('drop'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull();
		expect(h.drafts.value).toHaveLength(0);
		h.cleanup();
	});

	it('a drop carrying a Files flavor but zero files admits nothing (empty list guard)', async () => {
		const h = mountManager();
		document.dispatchEvent(dragEvent('dragenter'));
		document.dispatchEvent(dragEvent('drop', []));
		await settle();
		expect(h.drafts.value).toHaveLength(0);
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull(); // drop still resets
		h.cleanup();
	});

	it('window dragend resets the overlay and the depth counter', async () => {
		const h = mountManager();
		document.dispatchEvent(dragEvent('dragenter'));
		document.dispatchEvent(dragEvent('dragenter')); // depth 2
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).not.toBeNull();
		window.dispatchEvent(new Event('dragend'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull();
		// Depth was zeroed: one leave must not dip below zero or re-raise.
		document.dispatchEvent(dragEvent('dragleave'));
		await settle();
		expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull();
		h.cleanup();
	});

	it('while disabled the overlay says so and a drop admits nothing', async () => {
		const h = mountManager({ disabled: true });
		document.dispatchEvent(dragEvent('dragenter'));
		await settle();
		const overlay = document.querySelector('[data-testid="drop-overlay"]') as HTMLElement;
		expect(overlay.textContent).toContain('Cannot attach while input is locked');
		document.dispatchEvent(dragEvent('drop', [png('nope.png')]));
		await settle();
		expect(h.drafts.value).toHaveLength(0); // the drop is refused
		h.cleanup();
	});
});

describe('AttachmentManager — paste without clipboard items', () => {
	it('a paste event with no clipboardData (or no items) is a silent pass-through', () => {
		const h = mountManager();
		h.mgr.handlePaste({ preventDefault: () => {} } as unknown as ClipboardEvent);
		h.mgr.handlePaste({ preventDefault: () => {}, clipboardData: {} } as unknown as ClipboardEvent);
		expect(h.drafts.value).toHaveLength(0);
		h.cleanup();
	});
});

describe('AttachmentManager — serialize export (the only base64 moment)', () => {
	it('serializes admitted drafts to mediaType/base64 records', async () => {
		const h = mountManager();
		h.mgr.handlePaste({
			preventDefault: () => {},
			clipboardData: { items: [{ type: 'image/png', getAsFile: () => png('ser.png') }] }
		} as unknown as ClipboardEvent);
		await settle();
		const out = (await h.mgr.serialize()) as Array<{ mediaType: string; data: string; name?: string }>;
		expect(out).toHaveLength(1);
		expect(out[0].mediaType).toBe('image/png');
		expect(out[0].name).toBe('ser.png');
		expect(typeof out[0].data).toBe('string');
		h.cleanup();
	});
});
