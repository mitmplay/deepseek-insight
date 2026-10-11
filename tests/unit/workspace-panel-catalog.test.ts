/**
 * workspace-panel catalog gate — The Last Dictionary W1 task 1.2-T
 * (ADR 2026-10-08 D1/D4/D5).
 *
 * Pins the 17 migrated workspacePanelCopy keys: present in all four
 * locale catalogs, en verbatim-identical to the retired dictionary
 * values (leading separators of the truncated suffixes included),
 * non-en locales differing (real translations, not en echoes).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const MESSAGES_DIR = resolve(import.meta.dirname, '../../messages');
const FLEET = ['en', 'zh', 'id', 'es'];

/** Verbatim en values from the deleted src/lib/components/panels/workspace-panel-copy.ts. */
const EN_VERBATIM: Record<string, string> = {
	workspaceExplorerTitle: 'Workspace',
	workspaceExplorerCopyWorkspace: 'Copy Workspace fullpath',
	workspaceExplorerLoading: 'Loading…',
	workspaceExplorerLoadFailed: 'Could not list this folder',
	workspaceExplorerEmpty: 'Empty folder',
	workspaceExplorerTruncated: ' (truncated)',
	workspaceFilePreview: 'Preview',
	workspaceFileCopyFilename: 'Copy Filename fullpath',
	workspaceFileEdit: 'Edit',
	workspaceFileDirty: 'Unsaved changes',
	workspaceFileSave: 'Save',
	workspaceFileSaving: 'Saving…',
	workspaceFileSaveFailed: 'Save failed',
	workspaceFileStale: 'Saved — refresh to confirm the written file',
	workspaceFileLoadFailed: 'Could not read this file',
	workspaceFileTruncated: ' — first page only',
	workspacePanelCommonCopyColumn: 'Copy panel column as image (Shift+Click to save)'
};

function catalog(locale: string): Record<string, string> {
	return JSON.parse(readFileSync(resolve(MESSAGES_DIR, locale + '.json'), 'utf8'));
}

describe('workspace panel catalog migration (W1 1.2-T)', () => {
	it('all 17 migrated keys exist in every locale catalog', () => {
		for (const locale of FLEET) {
			const keys = Object.keys(catalog(locale));
			const missing = Object.keys(EN_VERBATIM).filter((k) => !keys.includes(k));
			expect(missing, `messages/${locale}.json missing workspace panel keys`).toEqual([]);
		}
	});

	it('en values are verbatim-identical to the retired dictionary (leading separators included)', () => {
		const en = catalog('en');
		for (const [key, value] of Object.entries(EN_VERBATIM)) {
			expect(en[key], key).toBe(value);
		}
	});

	it('truncated suffixes keep their leading separator in every locale', () => {
		for (const locale of FLEET) {
			const cat = catalog(locale);
			for (const key of ['workspaceExplorerTruncated', 'workspaceFileTruncated']) {
				expect(cat[key].length, `${locale}.${key} empty`).toBeGreaterThan(0);
				expect(cat[key][0], `${locale}.${key} lost its leading separator`).toMatch(/[\s\u2014\uff08(]/);
			}
		}
	});

	it('non-en locales are real translations, not en echoes', () => {
		for (const locale of FLEET.filter((l) => l !== 'en')) {
			const cat = catalog(locale);
			const echoed = Object.entries(EN_VERBATIM)
				.filter(([key, value]) => key !== 'workspaceFileEdit' /* id legitimately shares "Edit" */)
				.filter(([, value]) => value.length > 3)
				.filter(([key, value]) => cat[key] === value && !/^[ (\u2014\uff08]/.test(value));
			expect(echoed.map(([k]) => k), `messages/${locale}.json echoes en`).toEqual([]);
		}
	});
});
