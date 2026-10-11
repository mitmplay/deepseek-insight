import { describe, expect, it } from 'vitest';
import {
	pickTerminalTheme,
	TERMINAL_DARK_THEME,
	TERMINAL_LIGHT_THEME
} from '$lib/components/terminal/terminal-theme';

// Terminal Theming (ADR-0023 follow-up, 2026-10-11): terminal.theming true
// → the palette follows the resolved appearance; false → null (xterm's
// self-dark default, the ADR keep-list position).

describe('pickTerminalTheme', () => {
	it('returns null when theming is off — self-dark default preserved', () => {
		expect(pickTerminalTheme(false, 'light')).toBeNull();
		expect(pickTerminalTheme(false, 'dark')).toBeNull();
	});

	it('theming on resolves the light palette on a light floor', () => {
		expect(pickTerminalTheme(true, 'light')).toBe(TERMINAL_LIGHT_THEME);
	});

	it('theming on resolves the dark palette on a dark floor', () => {
		expect(pickTerminalTheme(true, 'dark')).toBe(TERMINAL_DARK_THEME);
	});

	it('the light palette clears 4.5:1 for its foreground on its canvas', () => {
		const lum = (hex: string): number => {
			const h = hex.replace('#', '');
			const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
			const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const ratio = (a: string, b: string) =>
			(Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
		// foreground + every ANSI color vs the white canvas — the directories/
		// files grammar depends on these being readable
		for (const [name, value] of Object.entries(TERMINAL_LIGHT_THEME)) {
			// selectionBackground is a tint, not text — exempt like cursorAccent
			if (name === 'cursorAccent' || name === 'selectionBackground' || name === 'background') continue;
			expect(ratio(value, TERMINAL_LIGHT_THEME.background), name).toBeGreaterThanOrEqual(3);
		}
		expect(ratio(TERMINAL_LIGHT_THEME.foreground, TERMINAL_LIGHT_THEME.background)).toBeGreaterThanOrEqual(4.5);
	});

	it('the dark palette keeps its self-dark contrast', () => {
		const lum = (hex: string): number => {
			const h = hex.replace('#', '');
			const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
			const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const ratio = (a: string, b: string) =>
			(Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
		expect(ratio(TERMINAL_DARK_THEME.foreground, TERMINAL_DARK_THEME.background)).toBeGreaterThanOrEqual(4.5);
	});
});
