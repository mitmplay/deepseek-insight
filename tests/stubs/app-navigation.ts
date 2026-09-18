/**
 * Test stub for $app/navigation (SvelteKit runtime module) — the workspace
 * route's seed strip calls replaceState; unit tests spy on it through the
 * shared mutable export (the vi.mock factory re-exports the same fn).
 */
export const navigationState = {
	replaceStateCalls: [] as Array<{ url: string; state: unknown }>
};

export function replaceState(url: string, state: unknown): void {
	navigationState.replaceStateCalls.push({ url, state });
}

export function pushState(url: string, state: unknown): void {
	void url;
	void state;
}

export function goto(url: string, opts?: unknown): void {
	void url;
	void opts;
}

export function invalidateAll(): void {}

/**
 * Test stub for afterNavigate: invokes the callback immediately at
 * registration — the page's seed strip registers it during component
 * init and expects it to run once the (fake) router owns the URL, so
 * unit tests observe the strip synchronously through mount + flush.
 */
export function afterNavigate(callback: () => void): void {
	callback();
}
