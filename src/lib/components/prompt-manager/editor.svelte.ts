import { parseTagWords, type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

type Row = SuggestedPrompt;

/**
 * PromptEditor — the editor machine of PromptManagerPanel (ADR-0022 W3):
 * the edit dialog state (edit* fields), the add-row state (new* fields),
 * the error strip, and their HTTP flows — saveEdit PATCH (changed fields
 * only), addPrompt POST with the 409 duplicate note, the inline macro
 * toggle — moved whole from the panel script.
 *
 * The panel constructs one instance per mount with the rows accessor
 * (saveEdit's unchanged-row lookup — a live accessor, never a cached
 * copy), the host onchanged callback, and a requestRefresh callback
 * (the table machine's refresh — no machine-to-machine import).
 */
export class PromptEditor {
	editingId = $state<number | null>(null);
	/** The row being edited — its table row stays highlighted while the
	 *  edit dialog is open (OCI user spec 2026-08-14). */
	editingRow = $state<Row | null>(null);
	editText = $state('');
	editLabel = $state('');
	editUses = $state('1');
	editMacro = $state(false);
	editTags = $state('');
	addingNew = $state(false);
	newText = $state('');
	newLabel = $state('');
	newTags = $state('');
	// Add-dialog uses/macro seeds (aligned with the Edit dialog's contract):
	// defaults mirror createPrompt's own insert defaults (1 / not-macro).
	newUses = $state('1');
	newMacro = $state(false);
	errorMsg = $state<string | null>(null);
	rows: () => Row[];
	onchanged?: () => void;
	requestRefresh: () => void;

	constructor(rows: () => Row[], onchanged?: () => void, requestRefresh?: () => void) {
		this.rows = rows;
		this.onchanged = onchanged;
		this.requestRefresh = requestRefresh ?? (() => {});
	}

	startEdit(row: Row) {
		this.editingId = row.id;
		this.editingRow = row;
		this.editText = row.text;
		this.editLabel = row.label ?? '';
		this.editUses = String(row.use_count);
		this.editMacro = row.macro === 1;
		this.editTags = row.tags ?? '';
	}

	cancelEdit() {
		this.editingId = null;
		this.editingRow = null;
	}

	/** The header toolbar's add button: open the add-row, clear the strip. */
	openAdd() {
		this.addingNew = true;
		this.errorMsg = null;
	}

	/** The add-row cancel path: reset the form. The header's cancel keeps
	 *  the seeds (uses/macro) — only the add-row's own cancel resets them
	 *  to the defaults (verbatim from the pre-refactor handlers). */
	cancelAdd(resetSeeds: boolean) {
		this.addingNew = false;
		this.newText = '';
		this.newLabel = '';
		this.newTags = '';
		if (resetSeeds) {
			this.newUses = '1';
			this.newMacro = false;
		}
		this.errorMsg = null;
	}

	async saveEdit(id: number) {
		const row = this.editingRow ?? this.rows().find((r) => r.id === id);
		if (!row) {
			this.cancelEdit();
			return;
		}
		const body: Record<string, unknown> = {};
		if (this.editText !== row.text) body.text = this.editText;
		if ((this.editLabel || null) !== (row.label ?? null)) {
			body.label = this.editLabel.trim() || null;
		}
		const uses = parseInt(this.editUses, 10);
		if (!isNaN(uses) && uses !== row.use_count) body.use_count = uses;
		if (this.editMacro !== (row.macro === 1)) body.macro = this.editMacro;
		if (this.editTags.trim() !== (row.tags ?? '')) body.tags = this.editTags;
		if (Object.keys(body).length === 0) {
			this.cancelEdit();
			return;
		}
		try {
			const res = await fetch(`/api/prompts/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				this.errorMsg = (err as { error?: string }).error || 'Save failed';
				return;
			}
			this.cancelEdit();
			this.onchanged?.();
			this.requestRefresh();
		} catch {
			this.errorMsg = 'Network error';
		}
	}

	/** Inline toggle: flip the macro flag without the edit dialog. */
	async toggleMacro(row: Row) {
		try {
			const res = await fetch(`/api/prompts/${row.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ macro: row.macro !== 1 })
			});
			if (!res.ok) {
				this.errorMsg = 'Save failed';
				return;
			}
			row.macro = row.macro === 1 ? 0 : 1;
			this.onchanged?.();
		} catch {
			this.errorMsg = 'Network error';
		}
	}

	async addPrompt() {
		if (!this.newText.trim()) return;
		try {
			const res = await fetch('/api/prompts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: this.newText,
					label: this.newLabel || undefined,
					use_count: (() => { const n = parseInt(this.newUses, 10); return !isNaN(n) && n !== 1 ? n : undefined; })(),
					macro: this.newMacro ? true : undefined,
					tags: parseTagWords(this.newTags).length > 0 ? parseTagWords(this.newTags) : undefined
				})
			});
			if (res.status === 409) {
				const err = (await res.json()) as { existing?: { use_count?: number } };
				this.errorMsg = `Already saved (${err.existing?.use_count ?? '?'} uses)`;
				return;
			}
			if (!res.ok) {
				this.errorMsg = 'Add failed';
				return;
			}
			this.addingNew = false;
			this.newText = '';
			this.newLabel = '';
			this.newTags = '';
			this.newUses = '1';
			this.newMacro = false;
			this.errorMsg = null;
			this.onchanged?.();
			this.requestRefresh();
		} catch {
			this.errorMsg = 'Network error';
		}
	}
}
