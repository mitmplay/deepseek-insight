/**
 * Turn End Stamp i18n gate (Wave 2 task 2.2-T): the turnStopped key must
 * exist in ALL locale catalogs — en/zh/id are the shipped triple (es rides
 * along for parity). Three Tongues discipline: a key missing in one tongue
 * is a silent fallback to English at render time.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages');

describe('turnStopped catalog key (Turn End Stamp, task 2.2)', () => {
	for (const locale of ['en', 'zh', 'id', 'es']) {
		it(`exists in ${locale}.json`, () => {
			const catalog = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8')) as Record<string, string>;
			expect(typeof catalog.turnStopped).toBe('string');
			expect(catalog.turnStopped.length).toBeGreaterThan(0);
		});
	}

	it('is translated, not English-copied, in zh and id', () => {
		const en = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8')) as Record<string, string>;
		const zh = JSON.parse(readFileSync(join(messagesDir, 'zh.json'), 'utf8')) as Record<string, string>;
		const id = JSON.parse(readFileSync(join(messagesDir, 'id.json'), 'utf8')) as Record<string, string>;
		expect(zh.turnStopped).not.toBe(en.turnStopped);
		expect(id.turnStopped).not.toBe(en.turnStopped);
	});
});
