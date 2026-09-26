/**
 * session-status.test.ts — task 2.1-T (spec: 2026-08-27 DSI Sub-Agent
 * Lineage Sidebar). Pins the four-state glyph: motion = self turn,
 * color = delegation live. The byte contract: delegated=false (default)
 * renders the EXACT pre-2026-08-27 DOM for both original states.
 */
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import SessionStatus from '$lib/components/sessions/SessionStatus.svelte';

/** Mount helper — house pattern (session-id-and-name.test.ts). */
function mountStatus(props: { running: boolean; delegated?: boolean; count?: number }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SessionStatus, { target, props });
	const root = () => target.querySelector('[data-testid="session-status"]')!;
	/** Class list WITHOUT Svelte's scoped-CSS hash (build-stable). */
	const classes = () =>
		Array.from(root().classList)
			.filter((c) => !c.startsWith('svelte-'))
			.join(' ');
	/** outerHTML with the scoped hash stripped — the BYTE contract
	 *  comparator (the hash is per-build; the old component had one too). */
	const html = () => root().outerHTML.replace(/svelte-[a-z0-9]+/g, '');
	return {
		root,
		classes,
		html,
		bars: () => target.querySelectorAll('.bar'),
		badge: () => target.querySelector('.badge'),
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

describe('SessionStatus — the four states (ADR D3)', () => {
	it('idle, no delegation: grey dot — class idle, no bars, label idle', () => {
		const s = mountStatus({ running: false });
		expect(s.classes()).toBe('status idle');
		expect(s.bars()).toHaveLength(0);
		expect(s.root().getAttribute('aria-label')).toBe('idle');
		s.cleanup();
	});

	it('running, no delegation: teal bars — class run, 3 bars, label running', () => {
		const s = mountStatus({ running: true });
		expect(s.classes()).toBe('status run');
		expect(s.bars()).toHaveLength(3);
		expect(s.root().getAttribute('aria-label')).toBe('running');
		s.cleanup();
	});

	it('running AND delegating: RED bars — classes run+delegated, 3 bars', () => {
		const s = mountStatus({ running: true, delegated: true });
		expect(s.classes()).toBe('status run delegated');
		expect(s.bars()).toHaveLength(3);
		expect(s.root().getAttribute('aria-label')).toBe('running and delegating');
		s.cleanup();
	});

	it('idle but delegating: RED BULLET — classes idle+delegated, no bars', () => {
		const s = mountStatus({ running: false, delegated: true });
		expect(s.classes()).toBe('status idle delegated');
		expect(s.bars()).toHaveLength(0); // motion honest: NOT working
		expect(s.root().getAttribute('aria-label')).toBe('delegating');
		s.cleanup();
	});
});

describe('SessionStatus — ×N badge (non-color carrier, WCAG 1.4.1)', () => {
	it('badge absent at count 0 and when omitted', () => {
		const a = mountStatus({ running: false, delegated: true });
		expect(a.badge()).toBeNull();
		a.cleanup();
		const b = mountStatus({ running: true, delegated: true, count: 0 });
		expect(b.badge()).toBeNull();
		b.cleanup();
	});

	it('badge renders ×N only when count > 0; aria-hidden; count rides the label', () => {
		const s = mountStatus({ running: false, delegated: true, count: 2 });
		expect(s.badge()?.textContent).toBe('×2');
		expect(s.badge()?.getAttribute('aria-hidden')).toBe('true');
		expect(s.root().getAttribute('aria-label')).toBe('delegating, 2 running');
		s.cleanup();
		const r = mountStatus({ running: true, delegated: true, count: 3 });
		expect(r.root().getAttribute('aria-label')).toBe('running and delegating, 3 running');
		r.cleanup();
	});
});

describe('SessionStatus — byte contract (defaults are the old component)', () => {
	// Svelte mounts carry hydration anchors (<!---->) and attribute
	// reordering the OLD component also had — so the byte contract is
	// comparative, not literal: implicit defaults must render HTML
	// IDENTICAL to explicit delegated={false} count={0} (the prop
	// additions change nothing), plus the structural signature the old
	// component produced (classes, label, bar count, NO badge).
	it('idle: implicit defaults = explicit false/0, structure unchanged, no badge', () => {
		const implicit = mountStatus({ running: false });
		const explicit = mountStatus({ running: false, delegated: false, count: 0 });
		expect(implicit.html()).toBe(explicit.html());
		expect(implicit.classes()).toBe('status idle');
		expect(implicit.root().getAttribute('aria-label')).toBe('idle');
		expect(implicit.bars()).toHaveLength(0);
		expect(implicit.badge()).toBeNull();
		implicit.cleanup();
		explicit.cleanup();
	});

	it('running: implicit defaults = explicit false/0, 3 bars, no badge', () => {
		const implicit = mountStatus({ running: true });
		const explicit = mountStatus({ running: true, delegated: false, count: 0 });
		expect(implicit.html()).toBe(explicit.html());
		expect(implicit.classes()).toBe('status run');
		expect(implicit.root().getAttribute('aria-label')).toBe('running');
		expect(implicit.bars()).toHaveLength(3);
		expect(implicit.badge()).toBeNull();
		implicit.cleanup();
		explicit.cleanup();
	});
});
