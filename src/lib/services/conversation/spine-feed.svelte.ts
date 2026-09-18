/**
 * spine-feed.svelte.ts — module-scope reactive cache for the spine feed
 * (KB "The Floor Decomposition" E4, 2026-09-06; the slash-directory
 * precedent's shape). ONE fetch per refreshMs tick serves every consumer
 * — rows, presets, and the a2a ledger window — where the route once ran
 * its own poll.
 *
 * Lifecycle (S3: no $effect at module scope): the interval is REF-COUNTED.
 * The first subscriber starts it (plus an immediate load); the last
 * unsubscribe stops it — the single-timer rule (BC-7) holds no matter how
 * many floors/consumers come and go, and no timer leaks when none remain.
 *
 * Degrade rules, carried from the route verbatim: an offline or failed
 * spine keeps the PREVIOUS rows (readers fall back to cold titles); the
 * a2a join fetches the FIRST sender's window only (one call per tick,
 * never per panel) and keeps its previous rows on failure.
 *
 * BC-2: client service — every byte rides /api/dsh/sessions and /api/a2a.
 * Purity (S7): this is the rune-legal module form — reactive state lives
 * here, fetches live here, consumers only read.
 */
import type { DsiA2aExchangeView, DsiPreset, DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
import { appConfig } from '$lib/services/config/app-config.svelte';

/** The shared feed state — reactive for every importer that reads it. */
export const spineFeed = $state({
	rows: [] as DsiSessionSummary[],
	presets: [] as DsiPreset[],
	a2aRows: [] as DsiA2aExchangeView[],
	/** The host workspace registry (2026-09-07, ADR D5 header-chip parity):
	 *  the SAME /api/dsh/sessions payload already carries it — parsed here
	 *  so the header chip can do the title-first lookup with zero new
	 *  fetches. Failure keeps the previous registry (the rows' rule). */
	workspaces: [] as DsiWorkspaceSummary[]
});

/** Subscriber count (observable for tests; the timer follows it). */
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** The a2a window's senders provider — the floor owner installs it with
 *  its subscription (the store never reads floor state itself). */
let a2aSenders: (() => string[]) | null = null;

/** Tick generation: a reset (tests) or teardown invalidates loads still
 *  in flight - a slow stale tick must never clobber fresher rows. */
let generation = 0;

/** One tick: spine first (rows + presets), then the a2a window. Every
 *  assignment is generation-guarded (see above). */
async function loadOnce(): Promise<void> {
	const gen = generation;
	try {
		const res = await fetch('/api/dsh/sessions');
		if (!res.ok) return;
		const body = (await res.json()) as {
			ok: boolean;
			sessions?: DsiSessionSummary[];
			presets?: DsiPreset[];
			workspaces?: DsiWorkspaceSummary[];
		};
		if (body.ok && gen === generation) {
			spineFeed.rows = body.sessions ?? [];
			spineFeed.presets = body.presets ?? [];
			spineFeed.workspaces = body.workspaces ?? [];
		}
	} catch {
		// Offline spine — readers fall back to cold titles (best effort).
	}
	// a2a join: every open panel's sender rows, one call per tick. Failure
	// keeps the previous rows — a read-only surface never errors at the
	// user (the chip is convenience, never a gate).
	try {
		const senders = a2aSenders?.() ?? [];
		if (senders.length > 0) {
			const res = await fetch(`/api/a2a?limit=100&from=${encodeURIComponent(senders[0])}`);
			if (res.ok) {
				const body = (await res.json()) as { ok: boolean; rows?: DsiA2aExchangeView[] };
				if (body.ok && gen === generation) spineFeed.a2aRows = body.rows ?? [];
		}
	}
	} catch {
		// Ledger read failed — chips stay as they were.
	}
}

/**
 * Subscribe to the feed. The FIRST subscriber starts the interval (and an
 * immediate load); each unsubscribe decrements — the LAST one stops the
 * timer. @param senders the a2a window's sender provider (first sender
 * wins; the floor passes its conversation sessions). @returns the
 * unsubscribe function.
 */
export function subscribeSpineFeed(senders?: () => string[]): () => void {
	a2aSenders = senders ?? a2aSenders;
	subscribers += 1;
	if (subscribers === 1) {
		void loadOnce();
		timer = setInterval(() => void loadOnce(), appConfig().home.refreshMs);
	}
	return () => {
		subscribers -= 1;
		if (subscribers <= 0) {
			subscribers = 0;
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
			a2aSenders = null;
		}
	};
}

/** Invalidation hook: an immediate load outside the cadence (manual
 *  refresh, a focus return) — never a second timer. */
export function refreshSpineFeed(): void {
	void loadOnce();
}

/** Test-only: reset state and tear down the timer (file isolation). */
export function resetSpineFeedForTests(): void {
	generation += 1;
	subscribers = 0;
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
	a2aSenders = null;
	spineFeed.rows = [];
	spineFeed.presets = [];
	spineFeed.a2aRows = [];
	spineFeed.workspaces = [];
}