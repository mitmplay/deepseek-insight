/**
 * Unit: storage-profile — the ONE home of the workspace-profile key
 * convention: every dsi-* localStorage key suffixes _<profile> when a
 * desk is active (?profile=widi → dsi-panels_widi, dsi-sidebar_widi,
 * dsi-session-filter_widi); no profile = the base key unchanged.
 */
import { describe, expect, it } from 'vitest';
import { dsiKey, sanitizeWorkspaceProfile } from '$lib/utils/storage-profile';

describe('sanitizeWorkspaceProfile', () => {
	it('keeps [A-Za-z0-9_-], caps 40, junk → null', () => {
		expect(sanitizeWorkspaceProfile('widi')).toBe('widi');
		expect(sanitizeWorkspaceProfile('Widi-2026_x')).toBe('Widi-2026_x');
		expect(sanitizeWorkspaceProfile('we ird!')).toBe('weird');
		expect(sanitizeWorkspaceProfile('a'.repeat(60))).toHaveLength(40);
		expect(sanitizeWorkspaceProfile('!!!')).toBeNull();
		expect(sanitizeWorkspaceProfile('')).toBeNull();
	});
});

describe('dsiKey — the dsi-* profile suffix convention', () => {
	it('null/undefined profile → the base key unchanged', () => {
		expect(dsiKey('dsi-panels')).toBe('dsi-panels');
		expect(dsiKey('dsi-panels', null)).toBe('dsi-panels');
		expect(dsiKey('dsi-panels', undefined)).toBe('dsi-panels');
	});

	it('every dsi-* family member suffixes the same way', () => {
		expect(dsiKey('dsi-panels', 'widi')).toBe('dsi-panels_widi');
		expect(dsiKey('dsi-sidebar', 'widi')).toBe('dsi-sidebar_widi');
		expect(dsiKey('dsi-session-filter', 'widi')).toBe('dsi-session-filter_widi');
	});
});
