/**
 * 2.2-T — Shelf Chrome i18n parity (ADR D6): every new shelf chrome
 * key exists in ALL locale catalogs. A missing key ships broken copy
 * in that locale at runtime — this fails loudly at the door.
 */
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import id from '../../messages/id.json';
import es from '../../messages/es.json';

const SHELF_CHROME_KEYS = [
	'skillsShelfCollapseAll',
	'skillsShelfExpandAll',
	'skillsShelfSearch',
	'skillsShelfTabInstall',
	'skillsShelfTabUninstall'
] as const;

const CATALOGS: Record<string, Record<string, string>> = { en, zh, id, es };

describe('shelf chrome i18n parity', () => {
	it('every chrome key exists in every catalog', () => {
		for (const [loc, catalog] of Object.entries(CATALOGS)) {
			for (const key of SHELF_CHROME_KEYS) {
				expect(catalog[key], loc + ' missing ' + key).toBeTruthy();
			}
		}
	});

	it('pre-existing shelf keys survive the chrome rework', () => {
		for (const [loc, catalog] of Object.entries(CATALOGS)) {
			for (const key of ['skillsShelfTitle', 'skillsShelfGeneratedAt', 'skillsShelfReload', 'skillsShelfInstall', 'skillsShelfUninstall']) {
				expect(catalog[key], loc + ' missing ' + key).toBeTruthy();
			}
		}
	});
});
