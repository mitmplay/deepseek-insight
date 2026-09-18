/**
 * Initialize or update ~/.dsi/settings.yaml with default keys
 * (OCI scripts/init-config.mjs pattern, ported 2026-08-25; YAML home since
 * 2026-09-07 — The Settings Panel ADR D1; honors the DSI_CONFIG_PATH env
 * seam, same as insight-config).
 *
 * - If the file doesn't exist: create it with full defaults.
 * - If the file exists: merge missing keys without overwriting existing values.
 * - The legacy config.json is never touched (the server migrates it on
 *   first read; this script writes only the new home).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

const CONFIG_DIR = join(homedir(), '.dsi');
const CONFIG_PATH = process.env.DSI_CONFIG_PATH ?? join(CONFIG_DIR, 'settings.yaml');

const DEFAULTS = {
	chat: {
		input: { maxRows: 15 },
		// accessConfirmTimeoutMs: 12000
		// macro (Prompt Macro, 2026-08-29; Sectioned Row ADR, same day):
		// maxLines: 25, maxDepth: 3 — the run's SECTION cap (a multi-line
		// plain-text block counts as ONE section — the compiler coalesces
		// it before the cap sees it) and the `?`-resolution depth cap.
		// Both are clamped [1..500] / [1..10]; out-of-range values fall
		// back to these defaults at read/apply time.
		macro: { maxLines: 25, maxDepth: 3 }
	},
	conversation: {
		// pollRunningMs: 500,
		// pollIdleMs: 2000,
		// statsBar: 'full-ledger' | 'partial' — full-ledger (default) renders
		// the host's whole-log projections (every closed step incl.
		// cancelled/failed, billed input incl. cache, TTFT/tok-per-s — the
		// same totals DSH shows); partial keeps the panel's own fold over
		// the entries it has seen (ADR 2026-09-08 "The Stats Bar" D3)
	},
	home: {
		// refreshMs: 5000
	},
	server: {
		// ringCapacity: 500
	},
	panel: {
		// defaultWidth: 730, minWidth: 480, maxWidth: 860,
		// minZoom: 0.25, maxZoom: 1.25
	},
	sidebar: {
		// defaultWidth: 280, minWidth: 200, maxWidth: 500,
		// placement: 'none' | 'panels-zoom' — none = beside the floor
		// (default); panels-zoom = first column inside the zoom row (OCI
		// ControlRail pattern)
	},
	prompts: {
		// tags: [session, git, plan, rca, kb] — the tag vocabulary offered by
		// the save popup and the manager chip row (The Prompt Tags ADR,
		// 2026-09-14, D5). Each word must match ^[a-z0-9_-]{1,32}$ after
		// lowercasing; invalid words are dropped; missing/empty list falls
		// back to the five defaults at read time.
		tags: ['session', 'git', 'plan', 'rca', 'kb']
	}
};

function deepMerge(target, source) {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (result[key] === undefined) {
			result[key] = source[key];
		} else if (
			typeof result[key] === 'object' &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof source[key] === 'object' &&
			source[key] !== null &&
			!Array.isArray(source[key])
		) {
			result[key] = deepMerge(result[key], source[key]);
		}
		// If key exists and is not an object, keep the existing value.
	}
	return result;
}

function main() {
	mkdirSync(CONFIG_DIR, { recursive: true });

	if (!existsSync(CONFIG_PATH)) {
		writeFileSync(CONFIG_PATH, stringify(DEFAULTS), 'utf-8');
		console.log(`Created ${CONFIG_PATH}`);
		return;
	}

	const existing = parse(readFileSync(CONFIG_PATH, 'utf-8'));
	const merged = deepMerge(existing, DEFAULTS);
	writeFileSync(CONFIG_PATH, stringify(merged), 'utf-8');
	console.log(`Updated ${CONFIG_PATH} (existing values kept, missing keys added)`);
}

main();
