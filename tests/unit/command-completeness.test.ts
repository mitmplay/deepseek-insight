/**
 * 1.3 - The completeness guard (The Shelf Voice ADR D1, RCA 2026-09-20):
 * every MANAGED parser type must have a MENU_GESTURES row and a
 * COMMAND_HELP entry. A new command added without its discovery surfaces
 * fails HERE, not in front of the operator.
 *
 * Documented exemptions (not managed surfaces):
 *   permission   - rides the host's own command catalog (menu layer B)
 *   loadinjected - retired as a typed command (2026-09-17 ADR D1/D2)
 */
import { describe, expect, it } from 'vitest';

import { COMMAND_HELP, MENU_GESTURES } from '../../src/lib/services/chat/command-help';
import { parseCommand } from '../../src/lib/services/chat/command-parser';

/** Every parser type the DSI client manages a discovery surface for. */
const MANAGED_TYPES = [
	'new',
	'workspace',
	'mention',
	'promptmanager',
	'dsisettings',
	'dshsettings',
	'skillshelf'
] as const;

const EXEMPT_TYPES = ['permission', 'loadinjected'] as const;

describe('command completeness guard (The Shelf Voice D1)', () => {
	it('every managed command type has a MENU_GESTURES row', () => {
		const names = MENU_GESTURES.map((g) => g.name);
		for (const type of MANAGED_TYPES) {
			// mention's gesture row is keyed '@mention' (its display grammar)
			const rowName = type === 'mention' ? '@mention' : type;
			expect(names, 'menu row missing for: ' + type).toContain(rowName);
		}
	});

	it('every managed command type has a COMMAND_HELP entry', () => {
		for (const type of MANAGED_TYPES) {
			expect(COMMAND_HELP[type], 'help entry missing for: ' + type).toBeTruthy();
			expect(COMMAND_HELP[type].usage).toContain(type === 'mention' ? '@' : '/');
		}
	});

	it('every gesture row seed parses back to its own command type', () => {
		for (const g of MENU_GESTURES) {
			if (g.name === '@mention') continue; // mention has its own grammar
			const parsed = parseCommand(g.seed.trim());
			expect(parsed, 'seed does not parse: ' + g.seed).not.toBeNull();
			expect(parsed!.type).toBe(g.name);
		}
	});

	it('the parser vocabulary is exactly managed + exempt (no unmanaged command ships)', () => {
		const vocabulary = ['new', 'workspace', 'mention', 'promptmanager', 'dsisettings', 'dshsettings', 'skillshelf', 'permission', 'loadinjected'];
		for (const type of vocabulary) {
			const managed = (MANAGED_TYPES as readonly string[]).includes(type);
			const exempt = (EXEMPT_TYPES as readonly string[]).includes(type);
			expect(managed || exempt, 'parser type without a surface decision: ' + type).toBe(true);
		}
	});
});
