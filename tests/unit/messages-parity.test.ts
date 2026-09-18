/**
 * Catalog key parity — Three Tongues W1 task 1.1-T (ADR 2026-09-12 D5).
 *
 * Probe finding 2026-09-12: the paraglide compiler does NOT fail the build
 * when a non-base locale lacks a key — it silently falls back to the base
 * locale (en). AC4's "missing key fails the build" therefore lives HERE:
 * this test is the catalog gate. A key present in en but missing in zh or
 * id fails pnpm test, and the failure names the key and locale.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const MESSAGES_DIR = resolve(import.meta.dirname, '../../messages');
const FLEET = ['en', 'zh', 'id', 'es'];

function catalogKeys(locale: string): Set<string> {
	const raw = JSON.parse(readFileSync(resolve(MESSAGES_DIR, locale + '.json'), 'utf8'));
	return new Set(Object.keys(raw).filter((k) => k !== '$schema'));
}

describe('messages catalog parity (en / zh / id / es)', () => {
	it('fleet directories exist with exactly the four locale catalogs', () => {
		const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json')).sort();
		expect(files).toEqual(['en.json', 'es.json', 'id.json', 'zh.json']);
	});

	it('every en key exists in zh, id, es (gate: missing key named in failure)', () => {
		const en = catalogKeys('en');
		expect(en.size).toBeGreaterThan(0);
		for (const locale of FLEET.filter((l) => l !== 'en')) {
			const keys = catalogKeys(locale);
			const missing = [...en].filter((k) => !keys.has(k));
			expect(missing, `messages/${locale}.json is missing keys present in en`).toEqual([]);
		}
	});

	it('no catalog carries keys unknown to en (typos and strays)', () => {
		const en = catalogKeys('en');
		for (const locale of FLEET.filter((l) => l !== 'en')) {
			const stray = [...catalogKeys(locale)].filter((k) => !en.has(k));
			expect(stray, `messages/${locale}.json has keys unknown to en`).toEqual([]);
		}
	});
});
