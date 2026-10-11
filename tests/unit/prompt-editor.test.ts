/**
 * PromptEditor unit tests — the editor machine of PromptManagerPanel
 * (ADR-0022 W3): edit-dialog state, add-row state, the error strip, and
 * their HTTP flows (saveEdit PATCH of changed fields only, addPrompt
 * POST with the 409 duplicate note, the inline macro toggle).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptEditor } from '$lib/components/prompt-manager/editor.svelte';

type Row = { id: number; text: string; label: string | null; use_count: number; macro: number; tags: string | null };

const row = (partial: Partial<Row> = {}): Row => ({
	id: 7,
	text: "hello world",
	label: "greet",
	use_count: 2,
	macro: 0,
	tags: "a, b",
	...partial
});

function make(rows: Row[] = [row()]) {
	const onchanged = vi.fn();
	const requestRefresh = vi.fn();
	const editor = new PromptEditor(() => rows, onchanged, requestRefresh);
	return { editor, onchanged, requestRefresh };
}

const res = (status: number, body: unknown = {}) =>
	Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

const sentBody = (call: number, editor: PromptEditor) => {
	void editor;
	const [, init] = vi.mocked(fetch).mock.calls[call];
	return JSON.parse((init as RequestInit).body as string);
};

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn(async () => res(200, {})));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("PromptEditor — dialog state", () => {
	it("startEdit prefills from the row; null label/tags become empty strings", () => {
		const { editor } = make([row({ label: null, tags: null, macro: 1 })]);
		editor.startEdit(row({ id: 9, label: null, tags: null, macro: 1 }));
		expect(editor.editingId).toBe(9);
		expect(editor.editText).toBe("hello world");
		expect(editor.editLabel).toBe("");
		expect(editor.editUses).toBe("2");
		expect(editor.editMacro).toBe(true);
		expect(editor.editTags).toBe("");
		editor.cancelEdit();
		expect(editor.editingId).toBeNull();
	});

	it("openAdd clears the strip; cancelAdd resets the form, seeds only on demand", () => {
		const { editor } = make();
		editor.newUses = "4";
		editor.newMacro = true;
		editor.errorMsg = "stale";
		editor.openAdd();
		expect(editor.addingNew).toBe(true);
		expect(editor.errorMsg).toBeNull();
		editor.newText = "x";
		editor.cancelAdd(false);
		expect(editor.addingNew).toBe(false);
		expect(editor.newText).toBe("");
		expect(editor.newUses).toBe("4"); // header cancel keeps the seeds
		expect(editor.newMacro).toBe(true);
		editor.openAdd();
		editor.cancelAdd(true);
		expect(editor.newUses).toBe("1");
		expect(editor.newMacro).toBe(false);
		expect(editor.errorMsg).toBeNull();
	});
});

describe("PromptEditor — saveEdit", () => {
	it("an unknown row id cancels the dialog silently", async () => {
		const { editor } = make();
		editor.startEdit(row());
		editor.editingRow = null;
		await editor.saveEdit(999);
		expect(fetch).not.toHaveBeenCalled();
		expect(editor.editingId).toBeNull();
	});

	it("no changed fields cancels without a request", async () => {
		const { editor } = make();
		editor.startEdit(row());
		await editor.saveEdit(7);
		expect(fetch).not.toHaveBeenCalled();
		expect(editor.editingId).toBeNull();
	});

	it("only the changed fields ride the PATCH", async () => {
		const { editor, onchanged, requestRefresh } = make();
		editor.startEdit(row());
		editor.editText = "changed text  ";
		editor.editUses = "9";
		await editor.saveEdit(7);
		expect(fetch).toHaveBeenCalledWith("/api/prompts/7", expect.objectContaining({ method: "PATCH" }));
		expect(sentBody(0, editor)).toEqual({ text: "changed text  ", use_count: 9 });
		expect(editor.editingId).toBeNull();
		expect(onchanged).toHaveBeenCalledTimes(1);
		expect(requestRefresh).toHaveBeenCalledTimes(1);
	});

	 it("a blank label normalizes to null; a whitespace-adjacent label trims on the wire", async () => {
		const { editor } = make();
		editor.startEdit(row());
		editor.editLabel = "   ";
		await editor.saveEdit(7);
		expect(sentBody(0, editor)).toEqual({ label: null });

		const second = make();
		second.editor.startEdit(row());
		second.editor.editLabel = " greet ";
		await second.editor.saveEdit(7);
		// the diff compares the RAW values, so " greet " !== "greet" sends —
		// but the wire value is the TRIMMED text (existing behavior, pinned)
		expect(sentBody(1, second.editor)).toEqual({ label: "greet" });
	});

	it("changed tags and a macro flip ride too", async () => {
		const { editor } = make();
		editor.startEdit(row());
		editor.editTags = "  x, y  ";
		editor.editMacro = true;
		await editor.saveEdit(7);
		expect(sentBody(0, editor)).toEqual({ tags: "  x, y  ", macro: true });
	});

	it("a failed PATCH surfaces the host error; junk error body falls back", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => res(400, { error: "dup" })));
		const { editor } = make();
		editor.startEdit(row());
		editor.editText = "new";
		await editor.saveEdit(7);
		expect(editor.errorMsg).toBe("dup");

		vi.stubGlobal("fetch", vi.fn(async () => res(500, "not json"))	);
		const second = make();
		second.editor.startEdit(row());
		second.editor.editText = "new";
		await second.editor.saveEdit(7);
		expect(second.editor.errorMsg).toBe("Save failed");
	});

	it("a network throw sets the network error strip", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
		const { editor } = make();
		editor.startEdit(row());
		editor.editText = "new";
		await editor.saveEdit(7);
		expect(editor.errorMsg).toBe("Network error");
	});
});

describe("PromptEditor — toggleMacro", () => {
	it("flips the row flag and notifies on success", async () => {
		const r = row({ macro: 0 });
		const { editor, onchanged } = make([r]);
		await editor.toggleMacro(r);
		expect(sentBody(0, editor)).toEqual({ macro: true });
		expect(r.macro).toBe(1);
		expect(onchanged).toHaveBeenCalledTimes(1);

		await editor.toggleMacro(r);
		expect(r.macro).toBe(0);
	});

	it("a failed toggle and a network throw set the error strip", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => res(500)));
		const r = row();
		const { editor } = make([r]);
		await editor.toggleMacro(r);
		expect(editor.errorMsg).toBe("Save failed");

		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
		const second = make();
		await second.editor.toggleMacro(second.editor.rows()[0]);
		expect(second.editor.errorMsg).toBe("Network error");
	});
});

describe("PromptEditor — addPrompt", () => {
	it("blank text refuses to POST", async () => {
		const { editor } = make();
		editor.newText = "   ";
		await editor.addPrompt();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("a successful add POSTs the payload and resets the form", async () => {
		const { editor, onchanged, requestRefresh } = make();
		editor.openAdd();
		editor.newText = "new prompt";
		editor.newLabel = "lbl";
		editor.newUses = "3";
		editor.newMacro = true;
		editor.newTags = "t1, t2";
		await editor.addPrompt();
		expect(sentBody(0, editor)).toEqual({
			text: "new prompt",
			label: "lbl",
			use_count: 3,
			macro: true,
			tags: ["t1", "t2"]
		});
		expect(editor.addingNew).toBe(false);
		expect(editor.newText).toBe("");
		expect(editor.newUses).toBe("1");
		expect(editor.errorMsg).toBeNull();
		expect(onchanged).toHaveBeenCalledTimes(1);
		expect(requestRefresh).toHaveBeenCalledTimes(1);
	});

	it("a 409 reports the duplicate with its use count", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => res(409, { existing: { use_count: 5 } })));
		const { editor } = make();
		editor.newText = "dup";
		await editor.addPrompt();
		expect(editor.errorMsg).toBe("Already saved (5 uses)");

		vi.stubGlobal("fetch", vi.fn(async () => res(409, {})));
		const second = make();
		second.editor.newText = "dup";
		await second.editor.addPrompt();
		expect(second.editor.errorMsg).toBe("Already saved (? uses)");
	});

	it("another failure sets Add failed; a throw sets Network error", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => res(400)));
		const { editor } = make();
		editor.newText = "x";
		await editor.addPrompt();
		expect(editor.errorMsg).toBe("Add failed");

		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
		const second = make();
		second.editor.newText = "x";
		await second.editor.addPrompt();
		expect(second.editor.errorMsg).toBe("Network error");
	});
});