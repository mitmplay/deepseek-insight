/**
 * capToPanelColumn — panel-scoped popups must not outgrow the panel
 * column they live in (2026-09-01): on the panel floor the viewport is
 * the wrong max-width reference — a column is 480–860px wide while the
 * viewport spans the whole desk — so the cap is `ratio` of the NEAREST
 * PanelColumn's width, applied as an inline style that overrides the
 * element's `max-w-[80vw]` class. Outside the floor (standalone
 * conversation) no column matches: the class stays, and the viewport
 * cap is the correct one.
 *
 * A ResizeObserver keeps the cap honest during gutter drags (the column
 * resizes live); where ResizeObserver does not exist (jsdom unit tests)
 * the cap applies once without live updates.
 *
 * Caller: `return capToPanelColumn(el)` inside an `$effect` on the bound
 * popup root — the effect's cleanup disconnects the observer when the
 * popup unmounts.
 */
export function capToPanelColumn(el: HTMLElement, ratio = 0.8): () => void {
	const column = el.closest<HTMLElement>('[data-testid="panel-column"]');
	if (!column) return () => {};
	const apply = (): void => {
		el.style.maxWidth = `${Math.floor(column.clientWidth * ratio)}px`;
	};
	apply();
	if (typeof ResizeObserver === 'undefined') return () => {};
	const observer = new ResizeObserver(apply);
	observer.observe(column);
	return () => observer.disconnect();
}
