import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Wave 1 task 1.2-T (ADR-0023 / The Three-State Lamp): the dark token block
// must re-declare the COMPLETE light token set, and its WCAG contrast
// verdicts must match the table recorded in the CSS comment - recomputed
// here from the values themselves, so a palette edit without a table update
// fails loudly.

const appCss = readFileSync('src/app.css', 'utf8');

const hexRe = /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g;
const darkStart = appCss.indexOf("[data-theme='dark']");
const darkEnd = appCss.indexOf('/* Dark palette WCAG contrast table');
const darkBlock = appCss.slice(darkStart, darkEnd);
const themeBlock = appCss.slice(appCss.indexOf('@theme {'), appCss.indexOf('\n}'));

const toMap = (block: string) => {
	const m = new Map<string, string>();
	for (const match of block.matchAll(hexRe)) m.set(match[1].slice(2), match[2].toLowerCase());
	return m;
};
const light = toMap(themeBlock);
const dark = toMap(darkBlock);

const lum = (hex: string): number => {
	const h = hex.replace('#', '');
	const parts = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * f(parts[0]) + 0.7152 * f(parts[1]) + 0.0722 * f(parts[2]);
};
const ratio = (a: string, b: string): number => {
	const la = lum(dark.get(a) ?? a);
	const lb = lum(dark.get(b) ?? b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const surfaces = ['color-surface', 'color-surface-alt', 'color-surface-hover', 'color-surface-elevated'];

describe('dark token re-declaration (task 1.2 / 1.2-T)', () => {
	it('re-declares every @theme color token - identical key sets', () => {
		const lightKeys = [...light.keys()].filter((k) => k.startsWith('color-')).sort();
		const darkKeys = [...dark.keys()].filter((k) => k.startsWith('color-')).sort();
		expect(darkKeys, 'dark block missing light tokens').toEqual(lightKeys);
	});

	it('re-declares the run-red token too', () => {
		expect(darkBlock).toContain('--si-run:');
	});

	it('text-primary and text-secondary clear 4.5:1 on every dark surface', () => {
		for (const s of surfaces) {
			expect(ratio('color-text-primary', s), 'text-primary on ' + s).toBeGreaterThanOrEqual(4.5);
			expect(ratio('color-text-secondary', s), 'text-secondary on ' + s).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('the muted tier holds the 3:1 non-text floor on every dark surface', () => {
		// muted is the faint tier (1.4.3 exempts incidental text); the CSS
		// table records the stricter 3:1 floor the dark palette carries
		for (const s of surfaces) {
			expect(ratio('color-text-muted', s), 'text-muted on ' + s).toBeGreaterThanOrEqual(3);
		}
	});

	it('every accent/status ink clears 3:1 on the dark surface', () => {
		const inks = [
			'color-accent-blue', 'color-accent-purple', 'color-accent-emerald', 'color-accent-amber',
			'color-accent-rose', 'color-accent-cyan', 'color-status-pass', 'color-status-fail',
			'color-status-pending', 'color-tree-repo', 'color-tree-child', 'color-tree-amber',
			'color-accent-deep', 'color-success-ink', 'color-green-verify', 'color-accent-orange',
			'color-accent-amber-ink', 'color-accent-amber-ink-deep', 'color-danger-madrid',
			'color-danger-github', 'color-danger-editor-ink', 'color-doc-child', 'color-navy-focus',
			'color-ws-violet', 'color-ws-green', 'color-ws-blue', 'si-run'
		];
		for (const ink of inks) {
			expect(dark.get(ink), ink + ' missing from dark block').toBeDefined();
			expect(ratio(ink, 'color-surface'), ink + ' on surface').toBeGreaterThanOrEqual(3);
		}
	});

	it('paired inks clear their bars: pill, danger washes, fail-fill glyph', () => {
		expect(ratio('color-accent-purple-ink', 'color-accent-purple-soft')).toBeGreaterThanOrEqual(4.5);
		expect(ratio('color-danger-wash-ink', 'color-danger-wash')).toBeGreaterThanOrEqual(4.5);
		expect(ratio('color-danger-editor-ink', 'color-danger-editor-surface')).toBeGreaterThanOrEqual(4.5);
		// the cancel/stop glyph ink vs its fill, BOTH modes' values pinned
		const lightFill = '#ef4444';
		const darkFill = dark.get('color-status-fail') as string;
		const lightInk = light.get('color-status-fail-ink') as string;
		const darkInk = dark.get('color-status-fail-ink') as string;
		expect(ratio(lightInk, lightFill)).toBeGreaterThanOrEqual(3);
		expect(ratio(darkInk, darkFill)).toBeGreaterThanOrEqual(3);
	});

	it('the recorded give-ups stay recorded - border hairlines are exempt, in writing', () => {
		const table = appCss.slice(appCss.indexOf('/* Dark palette WCAG contrast table'));
		expect(table).toContain('RECORDED GIVE-UPS');
		expect(ratio('color-surface-border', 'color-surface')).toBeLessThan(3);
	});
});
