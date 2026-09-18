/**
 * verify-ui-i18n — Three Tongues W3 task 3.1 (ADR 2026-09-12 D4).
 *
 * DSI port of DSH's scripts/verify-client-ui-i18n.ts (read in full,
 * 2026-09-12): locale dictionaries are the only files allowed to own UI
 * copy; presentation code receives copy through the generated m.*
 * functions. This gate scans .svelte TEMPLATE sources (DSH's scanner
 * walks JSX; ours walks Svelte's own template AST via svelte/compiler)
 * and rejects raw copy in text nodes and copy-bearing attributes.
 *
 * Exemptions:
 *  - {expressions} — {m.key()} is the sanctioned form; only static
 *    attribute values and literal text nodes are checked.
 *  - IMMUTABLE_LANGUAGE_TOKENS — units, booleans, single glyphs.
 *  - a line containing "i18n-skip" is exempt (mechanical strings like
 *    monospace glyphs), grep-able and auditable.
 *
 * Exit 0 = clean; exit 1 with file:line diagnostics otherwise.
 * Wired as "pnpm run verify-ui-i18n"; CI runs it before svelte-check.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'svelte/compiler';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** Copy-bearing attribute names + suffixes — mirrored from DSH's scanner. */
const COPY_ATTRIBUTES = new Set([
	'alt',
	'aria-description',
	'aria-label',
	'aria-valuetext',
	'cancelLabel',
	'closeLabel',
	'confirmLabel',
	'copyLabel',
	'description',
	'emptyLabel',
	'label',
	'placeholder',
	'title'
]);
const COPY_ATTRIBUTE_SUFFIX = /(?:Aria|Copy|Description|Heading|Label|Message|Placeholder|Summary|Text|Title|Tooltip)$/;

/** Non-copy tokens — units, code literals, single glyphs (DSH's set). */
const IMMUTABLE_LANGUAGE_TOKENS = new Set([
	'B', 'GB', 'K', 'KB', 'M', 'MB', 'ms', 's', '%',
	'false', 'true', 'null', 'undefined', 'n', 'x', 'A'
]);

interface Violation {
	file: string;
	line: number;
	text: string;
	reason: string;
}

function containsProductText(text: string): boolean {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return (
		normalized !== '' &&
		!IMMUTABLE_LANGUAGE_TOKENS.has(normalized) &&
		/\p{L}/u.test(normalized)
	);
}

/** Natural-text heuristic (DSH's): spaced words, CJK, or Capital start. */
function looksLikeNaturalText(text: string): boolean {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return /\s|[\u3400-\u9fff]/u.test(normalized) || /^[A-Z]/.test(normalized);
}

function copyAttribute(name: string): boolean {
	return (
		!name.endsWith('Key') &&
		(COPY_ATTRIBUTES.has(name) || COPY_ATTRIBUTE_SUFFIX.test(name))
	);
}

function lineOf(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i++) {
		if (source[i] === '\n') line++;
	}
	return line;
}

function lineText(source: string, index: number): string {
	let start = source.lastIndexOf('\n', index) + 1;
	let end = source.indexOf('\n', index);
	if (end === -1) end = source.length;
	return source.slice(start, end);
}

/** The i18n-skip exemption covers the node's own line AND the line above
 *  (an HTML comment marker sits on its own line — 3.1-T fixture). */
function isSkipped(source: string, index: number): boolean {
	if (lineText(source, index).includes('i18n-skip')) return true;
	const thisLineStart = source.lastIndexOf('\n', index) + 1;
	if (thisLineStart > 0) {
		const prevLineStart = source.lastIndexOf('\n', thisLineStart - 2) + 1;
		if (source.slice(prevLineStart, thisLineStart).includes('i18n-skip')) return true;
	}
	return false;
}

interface TemplateNode {
	type: string;
	name?: string;
	data?: string;
	start?: number;
	end?: number;
	attributes?: TemplateNode[];
	/** Svelte 5 modern AST: element children + fragment children. */
	nodes?: TemplateNode[];
	fragment?: TemplateNode;
	/** {#if} branches (Svelte 5 modern AST). */
	consequent?: TemplateNode;
	alternate?: TemplateNode;
	children?: TemplateNode[];
	value?: TemplateNode[] | TemplateNode | boolean | string;
	expression?: unknown;
}

function walk(node: TemplateNode, source: string, file: string, out: Violation[]): void {
	if (node.type === 'Text' && typeof node.data === 'string' && node.start !== undefined) {
		const text = node.data.replace(/\s+/g, ' ').trim();
		if (
			containsProductText(text) &&
			looksLikeNaturalText(text) &&
			!isSkipped(source, node.start)
		) {
			out.push({ file, line: lineOf(source, node.start), text: text.slice(0, 80), reason: 'raw text node' });
		}
	}
	if (node.type === 'Attribute' && typeof node.name === 'string') {
		const value = node.value;
		if (Array.isArray(value)) {
			for (const part of value) {
				if (
					part.type === 'Text' &&
					typeof part.data === 'string' &&
					part.start !== undefined &&
					copyAttribute(node.name) &&
					containsProductText(part.data) &&
					!isSkipped(source, part.start)
				) {
					out.push({
						file,
						line: lineOf(source, part.start),
						text: part.data.slice(0, 80),
						reason: 'copy-bearing attribute "' + node.name + '"'
					});
				}
			}
		}
	}
	// Expression-embedded literals ({cond ? 'Save' : 'Open'}) — the gap that
	// let NewChatButton's copy escape the first migration (bug 2026-09-12).
	if (typeof node.expression === 'object' && node.expression !== null) {
		walkEstree(node.expression as Record<string, unknown>, source, file, out);
	}
	// Svelte 5 modern AST: element children live in node.fragment.nodes,
	// fragment children in node.nodes (probe-verified 2026-09-12).
	for (const child of node.nodes ?? []) walk(child, source, file, out);
	if (node.fragment) walk(node.fragment, source, file, out);
	if (node.consequent) walk(node.consequent, source, file, out);
	if (node.alternate) walk(node.alternate, source, file, out);
	for (const attr of node.attributes ?? []) walk(attr, source, file, out);
}

const ESTREE_SKIP = new Set(['start', 'end', 'loc', 'range', 'leadingComments', 'trailingComments']);

/** Deep-walk an estree expression, flagging natural-text string literals
 *  and template-literal quasis. CallExpression IDENTIFIERS (m.x) are fine —
 *  only raw literals are copy. */
function walkEstree(node: unknown, source: string, file: string, out: Violation[]): void {
	if (!node || typeof node !== 'object') return;
	const n = node as Record<string, unknown>;
	if (typeof n.type === 'string') {
		if (n.type === 'Literal' && typeof n.value === 'string' && typeof n.start === 'number') {
			const text = n.value.replace(/\s+/g, ' ').trim();
			if (containsProductText(text) && looksLikeNaturalText(text) && !isSkipped(source, n.start)) {
				out.push({ file, line: lineOf(source, n.start), text: text.slice(0, 80), reason: 'string literal in expression' });
			}
			return;
		}
		if (n.type === 'TemplateLiteral' && Array.isArray(n.quasis)) {
			for (const q of n.quasis as Record<string, unknown>[]) {
				const value = q.value as { cooked?: unknown } | undefined;
				if (typeof value?.cooked === 'string' && typeof q.start === 'number') {
					const text = String(value.cooked).replace(/\s+/g, ' ').trim();
					if (containsProductText(text) && looksLikeNaturalText(text) && !isSkipped(source, q.start as number)) {
						out.push({ file, line: lineOf(source, q.start as number), text: text.slice(0, 80), reason: 'template literal in expression' });
					}
				}
			}
		}
	}
	for (const [k, v] of Object.entries(n)) {
		if (ESTREE_SKIP.has(k)) continue;
		if (Array.isArray(v)) for (const item of v) walkEstree(item, source, file, out);
		else if (v && typeof v === 'object') walkEstree(v, source, file, out);
	}
}

function listSvelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listSvelteFiles(full));
		else if (entry.name.endsWith('.svelte')) out.push(full);
	}
	return out;
}

/** Scan ONE svelte source — the 3.1-T fixture seam. */
export function findViolationsInSource(source: string): Violation[] {
	const out: Violation[] = [];
	const ast = parse(source, { modern: true }) as { fragment?: TemplateNode };
	if (ast.fragment) walk(ast.fragment, source, 'fixture.svelte', out);
	return out;
}

export function verify(): Violation[] {
	const violations: Violation[] = [];
	for (const file of listSvelteFiles(SRC)) {
		const source = readFileSync(file, 'utf8');
		let ast;
		try {
			ast = parse(source, { modern: true });
		} catch (e) {
			violations.push({ file: relative(ROOT, file), line: 0, text: String(e).slice(0, 80), reason: 'PARSE ERROR' });
			continue;
		}
		const frag = (ast as { fragment?: TemplateNode }).fragment;
		if (frag) walk(frag, source, relative(ROOT, file), violations);
	}
	return violations;
}

const isMain = process.argv[1] && import.meta.url === 'file://' + resolve(process.argv[1]);
if (isMain) {
	const found = verify();
	if (found.length > 0) {
		console.error('verify-ui-i18n: ' + found.length + ' violation(s) — components may not own copy (ADR 2026-09-12 D4):');
		for (const v of found) console.error('  ' + v.file + ':' + v.line + '  [' + v.reason + '] ' + JSON.stringify(v.text));
		process.exit(1);
	}
	console.log('verify-ui-i18n: clean');
}
