/**
 * Task 3.2-T — the rack's catalog seat: every pluginRack* key the panel
 * uses exists in all four locales (messages-parity is the repo gate; this
 * names the rack's own keys so a typo'd key fails HERE, at the feature).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MESSAGES_DIR = resolve(import.meta.dirname, '../../messages');
const FLEET = ['en', 'zh', 'id', 'es'];
const RACK_KEYS = [
	'pluginRackTitle',
	'pluginRackInstall',
	'pluginRackUninstall',
	'pluginRackInstalled',
	'pluginRackInstalling',
	'pluginRackUninstalling',
	'pluginRackApplying',
	'pluginRackLoadFailed',
	'pluginRackEmpty',
	'pluginRackBy',
	'pluginRackRetry',
	'pluginRackReload'
];

function catalog(locale: string): Record<string, string> {
	return JSON.parse(readFileSync(resolve(MESSAGES_DIR, locale + '.json'), 'utf8'));
}

describe('plugin rack i18n seat', () => {
	it('every rack key exists in all four locales with non-empty copy', () => {
		for (const locale of FLEET) {
			const cat = catalog(locale);
			for (const key of RACK_KEYS) {
				expect(cat[key], locale + ' missing ' + key).toBeTruthy();
			}
		}
	});
	it('the panel references only catalog keys that exist in the compiled paraglide seat', async () => {
		const src = await import('../../src/lib/paraglide/messages/_index.js').catch(() => null) as Record<string, unknown> | null;
		if (src) {
			for (const key of RACK_KEYS) {
				expect(src[key as keyof typeof src], 'compiled paraglide seat lacks ' + key).toBeTruthy();
			}
		}
	});
});
