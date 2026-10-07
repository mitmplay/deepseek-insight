/**
 * plugin-rack — shared types between the engine (rack.mjs), the API routes,
 * and the panel (ADR "The Plugin Rack" 2026-09-27). Mirrors the skill
 * shelf's type grammar (src/lib/server/skills/types.ts) but never imports
 * it — the two racks stay decoupled by design (PRD Module Communication Map).
 * Wire contract: the engine stamps every payload with v: 2 (Plugin Garden
 * ADR 2026-10-07: rows gain group/description/version).
 */

export const RACK_WIRE_VERSION = 2;

export interface RackPlugin {
	n: string; // rack address, e.g. '1'
	id: string; // plugin name from the reff line
	repo: string; // repo URL — install spec derives git+<repo>.git
	author: string | null;
	authorUrl?: string | null;
	group?: 'owned' | 'external'; // v2: owned = plugins/ directory scan, external = reff line
	description?: string | null; // v2: owned rows carry the package.json description
	version?: string | null; // v2: owned rows carry the package.json version
	installed: boolean; // profile manifest records the dep (D4, tail-matched)
	bundle: string | null; // derived copy of the bundles entry
}

export interface RackSnapshot {
	v: number;
	generatedAt: string;
	profile: string;
	plugins: RackPlugin[];
}

export interface RackApplyItem {
	n?: string;
	id?: string;
	ok: boolean;
	already?: boolean;
	error?: string;
}

export interface RackEnginePayload {
	v: number;
	ok: boolean;
	reused?: boolean;
	snapshot?: RackSnapshot;
	results?: RackApplyItem[];
	errors?: string[];
	present?: boolean;
}

/** The single API the routes consume; swap the runner for tests. */
export type RackEngineRunner = (
	enginePath: string,
	args: string[],
	timeoutMs?: number
) => Promise<string>; // resolves stdout JSON

export class RackEngineMissingError extends Error {
	readonly enginePath: string;
	constructor(enginePath: string) {
		super('rack engine not found: ' + enginePath);
		this.name = 'RackEngineMissingError';
		this.enginePath = enginePath;
	}
}

export class RackEngineFailedError extends Error {
	readonly payload: RackEnginePayload | null;
	constructor(message: string, payload: RackEnginePayload | null) {
		super(message);
		this.name = 'RackEngineFailedError';
		this.payload = payload;
	}
}
