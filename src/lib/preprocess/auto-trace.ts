/**
 * Svelte preprocessor: auto-injects `data-svelte="ComponentName"` on root HTML elements.
 *
 * Dev-time observability aid for mapping DOM nodes to components — no manual
 * `data-svelte` attributes needed. Works by parsing the component AST, finding
 * root-level HTML elements (including inside {#if}, {#each}, {#await} branches),
 * and injecting the attribute at the source level before compilation.
 *
 * Ported from openclaw-insight `src/lib/preprocess/auto-trace.ts` (OCI docs
 * 2026-07-15 §9), adapted to DSI's routes and component tree:
 *
 *   PromptBubble.svelte            → data-svelte="PromptBubble"
 *   +layout.svelte                  → data-svelte="LayoutRoot"
 *   routes/+page.svelte             → data-svelte="ConversationPage"
 *   +error.svelte                   → data-svelte="ErrorPage"
 *
 * `svelte:*` special elements (head, window, body) parse as their own node
 * types — never Elements — and are skipped; `<Component/>` references start
 * with a capital letter and are skipped too.
 */
import { parse } from 'svelte/compiler';

export function autoTrace() {
	return {
		name: 'auto-trace',
		markup({ content, filename }: { content: string; filename?: string }) {
			if (!filename || !filename.endsWith('.svelte')) return;
			if (filename.includes('node_modules')) return;

			const basename = filename.split(/[/\\]/).pop()!.replace('.svelte', '');

			const componentName = getComponentName(basename);

			let ast;
			try {
				ast = parse(content, { filename });
			} catch {
				return; // Let the compiler report syntax errors
			}

			const inserts: Array<{ pos: number; text: string }> = [];

			function walkNodes(nodes: any[]) {
				for (const node of nodes) {
					if (
						node.type === 'Element' &&
						/^[a-z]/.test(node.name) &&
						!node.name.startsWith('svelte:')
					) {
						// Skip if data-svelte already present in source
						const hasAttr = node.attributes?.some(
							(a: any) => a.type === 'Attribute' && a.name === 'data-svelte'
						);
						if (!hasAttr) {
							// Insert after '<tagname'
							inserts.push({
								pos: node.start + 1 + node.name.length,
								text: ` data-svelte="${componentName}"`
							});
						}
					} else if (node.type === 'IfBlock') {
						walkNodes(node.children ?? []);
						if (node.else) {
							walkNodes(node.else.children ?? []);
						}
					} else if (node.type === 'EachBlock') {
						walkNodes(node.children ?? []);
						if (node.else) {
							walkNodes(node.else.children ?? []);
						}
					} else if (node.type === 'AwaitBlock') {
						// AwaitBlock has pending/then/catch as children arrays
						walkNodes(node.children ?? []);
						if (node.pending) walkNodes(node.pending.children ?? []);
						if (node.then) walkNodes(node.then.children ?? []); // OCI original misses `then` (Svelte 5 puts blocks here)
						if (node.catch) walkNodes(node.catch.children ?? []);
					}
					// Text, Comment, Head, Component refs, etc. are skipped
				}
			}

			const rootChildren = ast.html?.children ?? [];
			walkNodes(rootChildren);

			if (inserts.length === 0) return;

			// Apply inserts in reverse position order to preserve indices
			let result = content;
			for (const ins of inserts.sort((a, b) => b.pos - a.pos)) {
				result = result.slice(0, ins.pos) + ins.text + result.slice(ins.pos);
			}

			return { code: result };
		}
	};
}

function getComponentName(basename: string): string {
	if (basename === '+layout') return 'LayoutRoot';
	if (basename === '+error') return 'ErrorPage';
	// One page since the Root-is-the-Floor ADR (2026-09-02): the app root
	// IS the conversation floor — the former HomePage label is retired.
	if (basename === '+page') return 'ConversationPage';
	return basename;
}
