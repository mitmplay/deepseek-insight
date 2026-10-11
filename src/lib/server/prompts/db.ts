/**
 * prompts-db (2026-08-28) — the Shelf: one global store of operator prompt
 * habits behind the DSI composer's `?` finder. Every admitted ordinary
 * send is recorded (first send creates the row, later sends increment);
 * search matches label/text prefix (legacy) or contains/fuzzy (`?`,
 * tier waterfall); ranking is use_count DESC, last_used_at DESC. Table is
 * capped at 5,000 rows — overflow prunes the oldest use_count=1 rows
 * (LRU of one-offs; multi-use rows are never pruned). A disposable FTS5
 * trigram index (schema v2) shadows the table for `?` search; any FTS
 * failure degrades to LIKE — never blocks open, never throws to a route.
 *
 * Spec: dev/specs/2026-08-28 - DSI Suggest Strip (PRD Module Map
 *      "prompts-db"; Tasks 1.1). Reference: OCI src/lib/server/prompts/db.ts
 *      (behavioral reference — semantics ported, names/seams DSI-native).
 *
 * Storage: node:sqlite DatabaseSync, zero new npm deps. File lives at
 * `~/.dsi/prompts.sqlite` by default (DSI_CONFIG_PATH sibling, same trust
 * boundary as a2a.sqlite — operator-copied 2026-08-28 with 30 seeded
 * rows); `prompts.dbPath` in settings.yaml moves it (~/ expanded), and
 * `DSI_PROMPTS_DB` env override is the test seam (each
 * node-env-globed test file points it at a tmp path before first open).
 *
 * Module boundary (PRD communication map): this module imports the
 * config layer only (for the directory) — never dsh-connection, never
 * dsh-rpc (D10), never the client suggest service (fuzzy math is
 * server-local so the client never crosses into $lib/server).
 */
// ADR-0022 W1-W4: every concern moved whole — this file is now the frozen
// re-export seam the four routes import; the concerns live in siblings.

// ADR-0022 W1: connection lifecycle moved whole to ./connection.ts —
// this shell re-exports the frozen public surface.
export {
	PROMPTS_DB_FILENAME,
	PROMPTS_DB_ENV,
	resolvePromptsDbPath,
	openPromptsDb,
	closePromptsDb,
	__resetPromptsDbCache
} from './connection.js';
export type { PromptRecord } from './connection.js';
export { FUZZY_MIN_LEN, diceSimilarity, wordSimilarity, splitQueryTerms } from './similarity.js';
export { searchPrompts } from './search.js';
export type { QueryTerm } from './similarity.js';

// ADR-0022 W4: queries + manager CRUD moved whole to ./crud.ts —
// the shell is now header + re-exports only (thin-shell standard).
export {
	findPromptByText,
	recordPromptUse,
	countPromptUse,
	renamePromptLabel,
	deletePrompt,
	listPrompts,
	createPrompt,
	updatePrompt
} from './crud.js';
