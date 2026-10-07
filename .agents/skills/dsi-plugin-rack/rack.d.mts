/** Type surface of the rack engine (rack.mjs) for test files. */
declare const CACHE_VERSION: 2;
export interface RackRow {
	n: string;
	id: string;
	group?: 'owned' | 'external';
	repo: string;
	author?: string | null;
	authorUrl?: string | null;
	version?: string | null;
	description?: string | null;
	order?: number;
	installSpec?: string;
	installed: boolean;
	pkg: string | null;
	bundle: string | null;
}
export interface GardenRow {
	id: string;
	group: 'owned';
	version: string | null;
	description: string | null;
	order: number;
	installSpec: string;
	repo: string;
}
export function scanGarden(gardenPath: string | undefined | null): GardenRow[];
export function parseReff(text: string): { plugins: { id: string; repo: string; author: string | null; authorUrl: string | null }[]; warnings: { code: string; detail: string }[] };
export function findDepKey(manifest: { deps: Record<string, string> }, id: string, repo?: string): string | null;
export function readManifest(path: string): { deps: Record<string, string>; bundles: string[]; missing: boolean };
export function isInstalled(manifest: { deps: Record<string, string> }, id: string, repo?: string): boolean;
export interface RackSource {
	id: string;
	name: string;
	author: string | null;
	repo: string;
	plugins: RackRow[];
}
export function buildSnapshot(args: { reffPath?: string; manifestPath?: string; gardenPath?: string; gardenRepo?: string; profile?: string }): { snapshot: { v: number; generatedAt: string; profile: string; sources: RackSource[]; plugins: RackRow[] }; warnings: { code: string; detail: string }[] };
export function toInstallSpec(repo: string): string;
export function installOwned(manifestPath: string, row: { id: string; installSpec: string }): string;
export function repoIdentity(url: string | undefined | null): string;
export function restoreClobberedBundles(manifestPath: string, preOwnedRows: { id: string; installSpec?: string; pkg?: string | null }[]): boolean;