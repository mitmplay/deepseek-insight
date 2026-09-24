/**
 * Unit tests for the terminal child-env scrub (Wave 1, task 1.2-T).
 * The ambient environment is the test fixture: save/restore process.env
 * around each case so the suite stays order-independent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scrubbedChildEnv } from '$lib/server/terminal/scrub.js';

const SAVED = { ...process.env };

function withEnv(entries: Record<string, string | undefined>): void {
	for (const key of Object.keys(process.env)) if (!(key in SAVED)) delete process.env[key];
	for (const [k, v] of Object.entries(entries)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
}

describe('scrubbedChildEnv', () => {
	afterEach(() => {
		withEnv(SAVED);
	});

	it('drops credential-shaped names (case-insensitive)', () => {
		withEnv({ DEEPSEEK_API_KEY: 'k', MY_SECRET: 's', DB_PASSWORD: 'p', ACCESS_TOKEN: 't', PATH: '/bin' });
		const env = scrubbedChildEnv();
		expect(env.DEEPSEEK_API_KEY).toBeUndefined();
		expect(env.MY_SECRET).toBeUndefined();
		expect(env.DB_PASSWORD).toBeUndefined();
		expect(env.ACCESS_TOKEN).toBeUndefined();
		expect(env.PATH).toBe('/bin');
	});

	it('drops reserved DSH_ and DSI_ namespaces case-insensitively', () => {
		withEnv({ DSH_SUBPROCESS_CONTROL: 'x', dsh_foo: 'y', DSI_AUTH: 'z', dsi_thing: 'w', HOME: '/h' });
		const env = scrubbedChildEnv();
		expect(env.DSH_SUBPROCESS_CONTROL).toBeUndefined();
		expect(env.dsh_foo).toBeUndefined();
		expect(env.DSI_AUTH).toBeUndefined();
		expect(env.dsi_thing).toBeUndefined();
		expect(env.HOME).toBe('/h');
	});

	it('keeps ordinary ambient variables (PATH, HOME, locale)', () => {
		withEnv({ PATH: '/bin', HOME: '/h', LANG: 'en_US.UTF-8' });
		const env = scrubbedChildEnv();
		expect(env.PATH).toBe('/bin');
		expect(env.HOME).toBe('/h');
		expect(env.LANG).toBe('en_US.UTF-8');
	});

	it('explicit entries merge after the scrub — deliberate opt-in survives', () => {
		withEnv({ PATH: '/bin', DEEPSEEK_API_KEY: 'hidden' });
		const env = scrubbedChildEnv({ DEEPSEEK_API_KEY: 'deliberate', TERM: 'xterm-256color' });
		expect(env.DEEPSEEK_API_KEY).toBe('deliberate');
		expect(env.TERM).toBe('xterm-256color');
	});

	it('an explicit undefined tombstone removes an ambient entry', () => {
		withEnv({ PATH: '/bin', LANG: 'C' });
		const env = scrubbedChildEnv({ LANG: undefined });
		expect(env.LANG).toBeUndefined();
		expect(env.PATH).toBe('/bin');
	});

	it('returns a fresh object — mutating it never touches process.env', () => {
		withEnv({ PATH: '/bin' });
		const env = scrubbedChildEnv();
		env.PATH = '/mutated';
		expect(process.env.PATH).toBe('/bin');
	});
});
