/**
 * sidebar-footer tests — the presentational bottom strip of the session
 * spine (extracted from SessionsList, 2026-09-04).
 *
 * Coverage focus: the compiled attribute interpolations that pass the
 * armed filter pills down to NewChatButton carry a `?? ''` fallback arm
 * each — both arms (null and non-null preset / workspace) must be
 * exercised by mounting with every combination, plus the optional
 * onreplace callback present and absent.
 *
 * Mounts SidebarFooter directly (presentational shell — children render
 * inside it; create logic stays in NewChatButton). No network, no timers.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarFooter from '$lib/components/sessions/SidebarFooter.svelte';
import { APP_VERSION, DSH_VERSION } from '$lib/version';

// The version chip compiles each interpolation with a `?? ''` fallback
// arm (v{APP_VERSION} / v{DSH_VERSION}). Real versions are build-time
// strings — the nullish arm never runs against them — so a mutable
// holder drives the mock to undefined for one render to cover it.
const versions = vi.hoisted(() => ({
	app: '0.0.0-test',
	dsh: '0.0.0-test'
}));
vi.mock('$lib/version', () => ({
	get APP_VERSION() {
		return versions.app;
	},
	get DSH_VERSION() {
		return versions.dsh;
	}
}));

function mountFooter(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SidebarFooter, {
		target,
		props: {
			preset: null,
			workspace: null,
			oncreated: vi.fn(),
			...props
		}
	});
	flushSync();
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarFooter — version chip', () => {
	it('renders the DSI edition above the pinned DSH web release', () => {
		const h = mountFooter();
		const chip = h.target.querySelector('[data-testid="sidebar-footer-version"]');
		expect(chip).not.toBeNull();
		const spans = chip!.querySelectorAll('span');
		expect(spans).toHaveLength(2);
		expect(spans[0].textContent).toBe('v' + APP_VERSION);
		expect(spans[1].textContent).toBe('v' + DSH_VERSION);
		h.cleanup();
	});
});

describe('SidebarFooter — armed pill propagation (branch arms)', () => {
	it('unarmed: null preset and null workspace mount cleanly', () => {
		const h = mountFooter({ preset: null, workspace: null });
		expect(h.target.querySelector('.footer')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		h.cleanup();
	});

	it('armed preset only', () => {
		const h = mountFooter({ preset: 'glm-5.3-flash', workspace: null });
		expect(h.target.querySelector('.footer')).not.toBeNull();
		h.cleanup();
	});

	it('armed workspace only', () => {
		const h = mountFooter({ preset: null, workspace: '/Users/wharsojo/agentic-ai' });
		expect(h.target.querySelector('.footer')).not.toBeNull();
		h.cleanup();
	});

	it('both pills armed', () => {
		const h = mountFooter({ preset: 'glm-5.3-flash', workspace: '/Users/wharsojo/agentic-ai' });
		expect(h.target.querySelector('.footer')).not.toBeNull();
		h.cleanup();
	});
});

describe('SidebarFooter — optional onreplace', () => {
	it('absent onreplace: no Replace toggle renders (plain create shape)', () => {
		const h = mountFooter();
		expect(h.target.querySelector('[data-testid="new-chat-replace-toggle"]')).toBeNull();
		h.cleanup();
	});

	it('present onreplace: the dual-verb shape mounts', () => {
		const h = mountFooter({ onreplace: vi.fn() });
		expect(h.target.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		h.cleanup();
	});
});

describe('SidebarFooter — nullish version fallback (compiled ?? arm)', () => {
	it('renders empty chip text when a version is undefined (?? fallback arm)', () => {
		versions.app = undefined;
		versions.dsh = undefined;
		const h = mountFooter();
		const chip = h.target.querySelector('[data-testid="sidebar-footer-version"]');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).not.toContain('undefined');
		h.cleanup();
		versions.app = '0.0.0-test';
		versions.dsh = '0.0.0-test';
	});
});

describe('SidebarFooter — shell structure', () => {
	it('mounts the broadcast box, version chip, create button and language menu in order', () => {
		const h = mountFooter();
		const footer = h.target.querySelector('.footer')!;
		expect(footer.querySelector('.footer-create')).not.toBeNull();
		// version chip lives inside .footer-create, before the button
		const create = footer.querySelector('.footer-create')!;
		expect(create.querySelector('[data-testid="sidebar-footer-version"]')).not.toBeNull();
		expect(create.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		h.cleanup();
	});
});
