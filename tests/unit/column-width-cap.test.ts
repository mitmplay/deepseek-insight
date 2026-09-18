/**
 * capToPanelColumn unit tests — the panel-scoped popup max-width cap,
 * mounted directly (its consumers' tests only reach the popup-inside-a-
 * column path with the real happy-dom ResizeObserver, which never fires).
 *
 * Pins the full contract:
 *  - OUTSIDE the panel floor (no [data-testid="panel-column"] ancestor)
 *    no cap applies and the returned cleanup is a safe no-op
 *  - INSIDE a column the cap is floor(clientWidth × ratio) applied as an
 *    inline maxWidth, ratio defaulting to 0.8
 *  - a ResizeObserver re-applies the cap when the column resizes live
 *    (gutter drag), and the returned cleanup disconnects it
 *  - where ResizeObserver does not exist the cap applies once and the
 *    cleanup stays callable
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { capToPanelColumn } from '$lib/utils/column-width-cap';

/** Minimal ResizeObserver double: records observe/disconnect, fires on demand. */
class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	observed: Element[] = [];
	disconnects = 0;
	callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		FakeResizeObserver.instances.push(this);
	}

	observe(el: Element): void {
		this.observed.push(el);
	}

	unobserve(): void {}

	disconnect(): void {
		this.disconnects += 1;
	}

	/** Simulates the browser reporting a column resize. */
	fire(): void {
		this.callback([], this as unknown as ResizeObserver);
	}
}

/** A panel column of the given clientWidth with a popup root inside it. */
function stage(clientWidth: number): { popup: HTMLElement; column: HTMLElement } {
	const column = document.createElement('div');
	column.setAttribute('data-testid', 'panel-column');
	Object.defineProperty(column, 'clientWidth', { configurable: true, value: clientWidth });
	const popup = document.createElement('div');
	column.appendChild(popup);
	document.body.appendChild(column);
	return { popup, column };
}

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('capToPanelColumn — outside the panel floor', () => {
	it('no column ancestor: no cap applied, cleanup is a safe no-op', () => {
		const el = document.createElement('div');
		document.body.appendChild(el);
		const cleanup = capToPanelColumn(el);
		expect(el.style.maxWidth).toBe('');
		expect(() => cleanup()).not.toThrow();
	});
});

describe('capToPanelColumn — inside a panel column', () => {
	it('caps maxWidth at floor(clientWidth × default 0.8) and observes the column', () => {
		vi.stubGlobal('ResizeObserver', FakeResizeObserver);
		FakeResizeObserver.instances = [];
		const { popup, column } = stage(640);
		const cleanup = capToPanelColumn(popup);
		expect(popup.style.maxWidth).toBe('512px'); // ⌊640 × 0.8⌋
		expect(FakeResizeObserver.instances).toHaveLength(1);
		expect(FakeResizeObserver.instances[0].observed).toEqual([column]);
		cleanup();
	});

	it('an explicit ratio overrides the 0.8 default', () => {
		vi.stubGlobal('ResizeObserver', FakeResizeObserver);
		FakeResizeObserver.instances = [];
		const { popup } = stage(640);
		const cleanup = capToPanelColumn(popup, 0.5);
		expect(popup.style.maxWidth).toBe('320px');
		cleanup();
	});

	it('a column resize re-applies the cap live (gutter drag)', () => {
		vi.stubGlobal('ResizeObserver', FakeResizeObserver);
		FakeResizeObserver.instances = [];
		const { popup, column } = stage(640);
		const cleanup = capToPanelColumn(popup);
		Object.defineProperty(column, 'clientWidth', { configurable: true, value: 820 });
		FakeResizeObserver.instances[0].fire();
		expect(popup.style.maxWidth).toBe('656px'); // ⌊820 × 0.8⌋
		cleanup();
	});

	it('the returned cleanup disconnects the observer (popup unmount)', () => {
		vi.stubGlobal('ResizeObserver', FakeResizeObserver);
		FakeResizeObserver.instances = [];
		const { popup } = stage(640);
		const cleanup = capToPanelColumn(popup);
		cleanup();
		expect(FakeResizeObserver.instances[0].disconnects).toBe(1);
	});

	it('no ResizeObserver: the cap applies once and the cleanup stays callable', () => {
		vi.stubGlobal('ResizeObserver', undefined);
		const { popup } = stage(640);
		const cleanup = capToPanelColumn(popup);
		expect(popup.style.maxWidth).toBe('512px');
		expect(() => cleanup()).not.toThrow();
	});
});
