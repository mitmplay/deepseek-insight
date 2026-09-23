/**
 * skill-shelf — shared types between the engine (shelf.mjs), the API routes, and the panel.
 * Wire contract version: the engine stamps every payload with v: 1 (Karpathy L2 weakest-point pin).
 */

export const SHELF_WIRE_VERSION = 1;

export interface ShelfSkill {
	n: string; // shelf address, e.g. '1.42'
	id: string; // folder name under ~/.agents/skills
	path: string; // path inside the source repo
	tier: string | null; // unstable tier marker ('in-progress'), null = stable
	installed: boolean; // folder exists on disk
	signed: boolean; // valid .dsi-provenance.json present (D5)
	installedFrom: string | null; // source id from the signature
	overview: string | null; // SKILL.md description/Overview text (installed only; null = unavailable)
}

export interface ShelfSource {
	id: string;
	name: string;
	author: string;
	/** Author profile URL from the SKR line's second link (Shelf Credentials D2); null = absent. */
	authorUrl?: string | null;
	/** Collection version from the repo's root package.json (Shelf Credentials D1); null = unavailable. */
	version?: string | null;
	repo: string;
	skills: ShelfSkill[];
}

/** Registry anomaly report (2026-09-21, auto-derivation): enumeration
 *  derives from the SKR URL itself, so an empty list is a REAL anomaly
 *  and the snapshot says why. */
export interface ShelfWarning {
	code: 'source-no-repo' | 'source-empty';
	source: string;
	detail: string;
}

export interface ShelfSnapshot {
	v: number;
	generatedAt: string;
	sources: ShelfSource[];
	warnings?: ShelfWarning[];
}

export interface ShelfApplyItem {
	n?: string;
	id?: string;
	ok: boolean;
	error?: string;
}

export interface EnginePayload {
	v: number;
	ok: boolean;
	reused?: boolean;
	snapshot?: ShelfSnapshot;
	results?: ShelfApplyItem[];
	errors?: string[];
	present?: boolean;
}

/** The single API the routes consume; swap the runner for tests.
 *  timeoutMs rides along so the refresh command's extended ceiling
	*  reaches whatever runner is installed (real execFile or test stub). */
export type EngineRunner = (enginePath: string, args: string[], timeoutMs?: number) => Promise<string>; // resolves stdout JSON

export class EngineMissingError extends Error {
	readonly enginePath: string;
	constructor(enginePath: string) {
		super('shelf engine not found: ' + enginePath);
		this.name = 'EngineMissingError';
		this.enginePath = enginePath;
	}
}

export class EngineFailedError extends Error {
	readonly payload: EnginePayload | null;
	constructor(message: string, payload: EnginePayload | null) {
		super(message);
		this.name = 'EngineFailedError';
		this.payload = payload;
	}
}

/** Uninstallable = on disk AND signed (ADR D5 control matrix). */
export function uninstallableIds(snapshot: ShelfSnapshot): string[] {
	return snapshot.sources.flatMap((s) => s.skills.filter((k) => k.installed && k.signed).map((k) => k.id));
}