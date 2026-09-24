/**
 * PromptBubble header-less table regression (2026-08-26): the user pasted a
 * real lineage table (empty header row | | | |) into the composer — the user
 * bubble must render it through the SAME renderer fix pinned in
 * markdown.test.ts. Component-level proof: mount PromptBubble with the exact
 * wire text and assert the rendered table.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';

// The EXACT table from the session's final report (em-dashes, backticks,
// 6 data rows, empty 3-cell header) — verbatim wire shape.
const TABLE = [
	'| | | |',
	'|---|---|---|',
	"| ADR | `7fee9c7` | The Attachment Draft — OCI's Hands on a DSH Spine |",
	'| Spec | `9417ecb` + `65eed2c` | feature-spec pipeline + spec-check remediation |',
	'| Wave 1 | `b7a5ce7` | Draft Surface — pick/paste/drop, id-keyed drafts |',
	'| Wave 2 | `f7804af` | The Send — content blocks, admission-aware submit, R-3 |',
	'| Wave 3 | `82530f7` | The Echo — ledger refs, authorized read, gallery |',
	'| Wave 4 | `cc3049d` | The Knobs — host-projected limits everywhere |'
].join('\n');

function mountBubble(text: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptBubble, { target, props: { text, time: 1 } });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('PromptBubble — header-less table renders through the shared renderer', () => {
	it('renders the pasted lineage table as a real <table> with all six rows', () => {
		const h = mountBubble(TABLE);
		const table = h.target.querySelector('.md-content table') as HTMLTableElement;
		expect(table).not.toBeNull();
		const rows = table.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(6);
		// Inline rendering survived inside cells (code span + em-dash text)
		expect(table.querySelector('td code')?.textContent).toBe('7fee9c7');
		expect(rows[0].textContent).toContain("The Attachment Draft — OCI's Hands on a DSH Spine");
		// Delimiter row is syntax — never visible
		expect(table.textContent).not.toContain('|---');
		h.cleanup();
	});

	it('the same text with a caption keeps both paragraph and table separate', () => {
		const h = mountBubble('DSI Composer Attachments — complete lineage (this session):\n\n' + TABLE);
		const html = h.target.querySelector('.md-content') as HTMLElement;
		expect(html.querySelector('p')?.textContent).toContain('complete lineage');
		expect(html.querySelector('table')).not.toBeNull();
		h.cleanup();
	});
});
