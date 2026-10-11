// Terminal Theming (ADR-0023 follow-up, 2026-10-11) — terminal.theming:
// true in ~/.dsi/settings.yaml makes the terminal follow html[data-theme].
// Default OFF: the terminal stays self-dark (xterm's own palette), the
// documented ADR-0023 keep-list position.

export type ResolvedTheme = 'light' | 'dark';

export interface XtermTheme {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

/** Light ANSI palette — every entry measured for >= 4.5:1 on the #ffffff
 *  canvas (the 16-color grammar directories/files depend on). */
export const TERMINAL_LIGHT_THEME: XtermTheme = {
	background: '#ffffff',
	foreground: '#1f2328',
	cursor: '#1f2328',
	cursorAccent: '#ffffff',
	selectionBackground: '#b6d7ff',
	black: '#1f2328',
	red: '#c01c28',
	green: '#1a7f37',
	yellow: '#955c00',
	blue: '#0969da',
	magenta: '#8250df',
	cyan: '#0f7f8c',
	white: '#6e7781',
	brightBlack: '#57606a',
	brightRed: '#a40e26',
	brightGreen: '#116329',
	brightYellow: '#7d4e00',
	brightBlue: '#0550ae',
	brightMagenta: '#6639ba',
	brightCyan: '#0b6a75',
	brightWhite: '#1f2328'
};

/** Dark palette — the self-dark look, made explicit (github-dark family)
 *  so theming:true in a dark desk renders identical to the default. */
export const TERMINAL_DARK_THEME: XtermTheme = {
	background: '#0d1117',
	foreground: '#c9d1d9',
	cursor: '#c9d1d9',
	cursorAccent: '#0d1117',
	selectionBackground: '#264f78',
	black: '#484f58',
	red: '#ff7b72',
	green: '#3fb950',
	yellow: '#d29922',
	blue: '#58a6ff',
	magenta: '#bc8cff',
	cyan: '#39c5cf',
	white: '#b1bac4',
	brightBlack: '#6e7681',
	brightRed: '#ffa198',
	brightGreen: '#56d364',
	brightYellow: '#e3b341',
	brightBlue: '#79c0ff',
	brightMagenta: '#d2a8ff',
	brightCyan: '#56d4dd',
	brightWhite: '#f0f6fc'
};

/** theming off → null (xterm's own default, the self-dark look).
 *  theming on → the palette for the resolved appearance. */
export function pickTerminalTheme(
	theming: boolean,
	resolved: ResolvedTheme
): XtermTheme | null {
	if (!theming) return null;
	return resolved === 'light' ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME;
}
