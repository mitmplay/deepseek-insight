/**
 * workspace-panel-copy — the ONE typed copy dictionary for the two live
 * workspace panels (Workspace Explorer W3 task 3.1). Locale-owned copy:
 * no user-facing string is hardcoded in a component — both panels read
 * these keys, so a future locale layer translates one table. Keys are
 * grouped per panel; shared tooltips live under "common".
 */
export const workspacePanelCopy = {
	explorer: {
		/** Tree header label — the workspace title (basename of root). */
		title: 'Workspace',
		/** PanelHeader copy button's accessible label — copies the root. */
		copyWorkspace: 'Copy Workspace fullpath',
		/** Toolbar refresh button label and tooltip. */
		refresh: 'Refresh',
		/** Toolbar collapse-all button label and tooltip. */
		collapseAll: 'Collapse all',
		/** Row text while a level fetch is in flight. */
		loading: 'Loading…',
		/** Row text when the level fetch failed (refusal or transport). */
		loadFailed: 'Could not list this folder',
		/** Row text for an empty directory. */
		empty: 'Empty folder',
		/** Row suffix when the entry cap cut children. */
		truncated: ' (truncated)',
		/** Accessible label for a tree row. */
		row: 'tree row'
	},
	file: {
		/** Preview tab label (markdown files only). */
		preview: 'Preview',
		/** PanelHeader copy button's accessible label — the full path. */
		copyFilename: 'Copy Filename fullpath',
		/** Edit tab label. */
		edit: 'Edit',
		/** Dirty-edit indicator — a reload would discard the draft. */
		dirty: 'Unsaved changes',
		/** Save button label (the Delegated Save, 2026-09-11 D4). */
		save: 'Save',
		/** Save button label while the delegated turn is unanswered. */
		saving: 'Saving…',
		/** Failure line when the save turn is refused. */
		saveFailed: 'Save failed',
		/** Post-receipt note — the receipt is acceptance, not proof of bytes. */
		stale: 'Saved — refresh to confirm the written file',
		/** Failure line when the file read refuses. */
		loadFailed: 'Could not read this file',
		/** Suffix when the fetched page stops before the file's end. */
		truncated: ' — first page only'
	},
	common: {
		/** Tooltip label before the verbatim full path. */
		fullPath: 'Full path',
		/** Canvas-copy button tooltip — captures the whole panel column. */
		copyColumn: 'Copy panel column as image (Shift+Click to save)'
	}
} as const;

export type WorkspacePanelCopy = typeof workspacePanelCopy;