import { describe, expect, it, vi } from 'vitest';
import { KeyboardRouter } from '../../../../src/lib/components/composer/controller/keyboard-router.svelte';

/** Direct unit home for the LADDER itself (D2 amendment): precedence
 *  asserted without rendering a composer. All three machines are
 *  doubles that claim nothing unless a test says so. */

function make(opts: {
	stripHandles?: boolean;
	slashHandles?: boolean;
	helpHandles?: boolean;
	composing?: boolean;
	runRearm?: boolean;
}) {
	const strip = {
		handles: vi.fn(() => opts.stripHandles ?? false),
		runRearmNeeded: vi.fn(() => opts.runRearm ?? false),
		rearmRun: vi.fn(),
		accept: vi.fn(),
		cycle: vi.fn(),
		close: vi.fn(),
		rows: [{}, {}, {}],
		index: 0
	};
	const slash = {
		handles: vi.fn(() => opts.slashHandles ?? false),
		memoize: vi.fn(),
		pickHighlighted: vi.fn(),
		cycle: vi.fn(),
		rows: [{}, {}, {}]
	};
	const help = {
		handles: vi.fn(() => opts.helpHandles ?? false),
		onKey: vi.fn(() => true)
	};
	const submit = vi.fn(async () => true);
	const router = new KeyboardRouter({
		strip: strip as never,
		slash: slash as never,
		help: help as never,
		isComposing: () => opts.composing ?? false,
		submit
	});
	return { router, strip, slash, help, submit };
}

const key = (k: string, o: Record<string, boolean> = {}) =>
	new KeyboardEvent('keydown', { key: k, cancelable: true, ...o });

describe('KeyboardRouter', () => {
	it('strip outranks help and slash: with all three live, Tab accepts the strip', async () => {
		const h = make({ stripHandles: true, slashHandles: true, helpHandles: true });
		await h.router.onKey(key('Tab'));
		expect(h.strip.accept).toHaveBeenCalled();
		expect(h.slash.pickHighlighted).not.toHaveBeenCalled();
		expect(h.help.onKey).not.toHaveBeenCalled();
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('help outranks slash when the strip is silent', async () => {
		const h = make({ slashHandles: true, helpHandles: true });
		await h.router.onKey(key('Enter'));
		expect(h.help.onKey).toHaveBeenCalled();
		expect(h.slash.pickHighlighted).not.toHaveBeenCalled();
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('IME composing (BC-8): nothing intercepts; plain Enter submits', async () => {
		const h = make({ stripHandles: true, slashHandles: true, helpHandles: true, composing: true });
		const enter = key('Enter');
		await h.router.onKey(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(h.submit).toHaveBeenCalled();
		expect(h.strip.accept).not.toHaveBeenCalled();
	});

	it('run-shaped draft with no rows: Enter re-arms instead of sending (BC-9)', async () => {
		const h = make({ runRearm: true });
		await h.router.onKey(key('Enter'));
		expect(h.strip.rearmRun).toHaveBeenCalled();
		expect(h.submit).not.toHaveBeenCalled();
	});

	it('nothing live: plain Enter falls through to the submit ladder', async () => {
		const h = make({});
		await h.router.onKey(key('Enter'));
		expect(h.submit).toHaveBeenCalled();
	});

	it('slash live: Escape memo-closes; unclaimed keys fall through to submit', async () => {
		const h = make({ slashHandles: true });
		await h.router.onKey(key('Escape'));
		expect(h.slash.memoize).toHaveBeenCalled();
		expect(h.submit).not.toHaveBeenCalled();
		// an unclaimed key is just text for the textarea — the final rung
		// only fires on Enter (no preventDefault either: the box keeps it)
		const a = key('a');
		await h.router.onKey(a);
		expect(a.defaultPrevented).toBe(false);
		expect(h.submit).not.toHaveBeenCalled();
	});
});
