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
}

export interface ShelfSource {
	id: string;
	name: string;
	author: string;
	repo: string;
	skills: ShelfSkill[];
}

export interface ShelfSnapshot {
	v: number;
	generatedAt: string;
	sources: ShelfSource[];
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

/** The single API the routes consume; swap the runner for tests. */
export type EngineRunner = (enginePath: string, args: string[]) => Promise<string>; // resolves stdout JSON

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