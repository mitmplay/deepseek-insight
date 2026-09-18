/**
 * tool-titles — variant titles for tool rows (POC-3 W2, task 2.5; BC-F:
 * naming parity with DSH's own UI — the literals and the classification
 * live in tool-call-model.ts; THIS file is the one home on this side).
 *
 * Source of truth pinned 2026-08-21 from
 * packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:
 *
 *   VARIANT_TITLES = { search:'Search', read:'Read', bash:'Bash',
 *                      write:'Write', edit:'Edit', code:'Code',
 *                      others:'Tool call' }
 *   TOOL_VARIANTS  = { bash:'bash', pwsh:'bash', read:'read',
 *                      web_fetch:'read', web_search:'search',
 *                      grep:'search', glob:'search', write:'write',
 *                      edit:'edit', run_code:'code', … }
 *
 * classifyTool: unknown name → 'others' → fallback title `Tool call`.
 * Pure data + one function; no I/O, shared by every surface that names a
 * tool (the chip today; W3+ controls later).
 */

/** DSH variant keys (tool-call-model.ts ToolRowVariant). */
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others';

/** Variant → title (BC-F literals, byte-identical to the DSH table). */
export const VARIANT_TITLES: Record<ToolRowVariant, string> = {
	search: 'Search',
	read: 'Read',
	bash: 'Bash',
	write: 'Write',
	edit: 'Edit',
	code: 'Code',
	others: 'Tool call'
};

/** Wire tool name → row variant (tool-call-model.ts TOOL_VARIANTS). */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
	bash: 'bash',
	pwsh: 'bash',
	read: 'read',
	web_fetch: 'read',
	web_search: 'search',
	grep: 'search',
	glob: 'search',
	write: 'write',
	edit: 'edit',
	run_code: 'code'
};

/** Classify a wire tool name; unknown → 'others' (fallback `Tool call`). */
export function classifyTool(toolName: string): ToolRowVariant {
	return TOOL_VARIANTS[toolName] ?? 'others';
}

/** Display title for a wire tool name (BC-F: Bash/Read/…/Tool call). */
export function toolTitle(toolName: string): string {
	return VARIANT_TITLES[classifyTool(toolName)];
}

/** Variant → catalog message getter: the localized title for RENDER sites.
 * Resolved through the reactive t seat (locale-state) so chip labels flip
 * live; VARIANT_TITLES above stays the byte-identical BC-F English table
 * for non-UI consumers (code-programs). */
import * as m from '$lib/paraglide/messages';
export const TOOL_TITLE_MESSAGES: Record<ToolRowVariant, () => string> = {
	search: () => m.toolTitleSearch(),
	read: () => m.toolTitleRead(),
	bash: () => m.toolTitleBash(),
	write: () => m.toolTitleWrite(),
	edit: () => m.toolTitleEdit(),
	code: () => m.toolTitleCode(),
	others: () => m.toolTitleToolCall()
};
