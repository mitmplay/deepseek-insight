#!/usr/bin/env node
/**
 * dsi-plugin-rack — the rack engine (ADR "The Plugin Rack" 2026-09-27, D2–D6).
 * Plain Node, JSON on stdout, every payload carries v: 1.
 *
 *   rack.mjs refresh [--reload] [--reff PATH] [--cache PATH] [--manifest PATH]
 *                    [--profile P] [--dsh-cmd CMD]
 *   rack.mjs apply install|remove <n|id>...
 *   rack.mjs snapshot-status
 *
 * Reading is ours (reff parse, snapshot); WRITING is dsh's — apply shells out
 * to `dsh plugin --profile <p> add|remove` and never hand-edits the profile
 * manifest (D3). The manifest is provenance's state home (D4): installed =
 * dependencies[id] AND dsh.profile.bundles includes id. Gates surface, they
 * never auto-clear (D6).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const CACHE_VERSION = 2;

function parseArgs(argv) {
	const out = { command: argv[0], reload: false, reff: null, cache: null, manifest: null, profile: process.env.DSH_PROFILE ?? 'web', dshCmd: null, targets: [] };
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--reload') out.reload = true;
		else if (a === '--reff') out.reff = argv[++i];
		else if (a === '--cache') out.cache = argv[++i];
		else if (a === '--manifest') out.manifest = argv[++i];
		else if (a === '--profile') out.profile = argv[++i];
		else if (a === '--garden') out.garden = argv[++i];
		else if (a === '--garden-repo') out.gardenRepo = argv[++i];
		else if (a === '--dsh-cmd') out.dshCmd = argv[++i];
		else out.targets.push(a);
	}
	return out;
}

/** plugins-reff.md line grammar: `1. [name](repo-url) - [author](author-url)`
 *  (author side optional). One line IS one plugin (ADR §2.1). */
export function parseReff(text) {
	const plugins = [];
	const warnings = [];
	const re = /^\s*\d+\.\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s+-\s+\[([^\]]+)\]\(([^)\s]+)\))?\s*$/;
	for (const line of text.split(/\r?\n/)) {
		if (/^\s*\d+\.\s+\[/.test(line) && !re.test(line)) {
			warnings.push({ code: 'reff-malformed-line', detail: line.trim() });
			continue;
		}
		const m = line.match(re);
		if (m) plugins.push({ id: m[1], repo: m[2], author: m[3] ?? null, authorUrl: m[4] ?? null });
	}
	if (plugins.length === 0) warnings.push({ code: 'reff-empty', detail: 'no plugin lines found' });
	return { plugins, warnings };
}


/** Owned-species enumeration (ADR "The Plugin Garden" 2026-10-07, D1/D2):
 *  every direct child of the garden dir with a package.json wiring
 *  dsh.bundle.patch is one owned rack row, identified by its OWN package
 *  name. Rows carry version/description from the same file and an optional
 *  dsh.rack.order for display sort. Returns [] for a missing garden. */
export function scanGarden(gardenPath) {
	if (!gardenPath || !existsSync(gardenPath)) return [];
	const rows = [];
	for (const child of readdirSync(gardenPath, { withFileTypes: true })) {
		if (!child.isDirectory()) continue;
		const pkgPath = join(gardenPath, child.name, 'package.json');
		if (!existsSync(pkgPath)) continue;
		let pkg;
		try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
		const patch = pkg && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
		if (!patch) continue;
		const order = (pkg.dsh && pkg.dsh.rack && pkg.dsh.rack.order) ?? Number.POSITIVE_INFINITY;
		rows.push({
			id: pkg.name,
			group: 'owned',
			version: pkg.version ?? null,
			description: pkg.description ?? null,
			order,
			installSpec: 'link:' + join(gardenPath, child.name),
			repo: 'link:' + join(gardenPath, child.name)
		});
	}
	return rows.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/** Repository identity (ADR-0016 D1): a catalog entry identifies a
 *  REPOSITORY, not a URL string. Strip protocol, .git suffix, trailing
 *  slashes and any /tree/<ref>(/...)? browse subtree, then keep the
 *  owner/repo tail. Two URLs with the same identity are one rack group. */
export function repoIdentity(url) {
	const s = String(url || '')
		.replace(/^[a-z+]+:(\/\/)?/i, '') // protocol (https://, git+, github:)
		.split('/tree/')[0] // a github /tree/<ref>/... browse URL is a view INSIDE a repo
		.replace(/\/+$/, '')
		.replace(/\.git$/i, '')
		.replace(/\/+$/, '');
	return s.split('/').slice(-2).join('/');
}

/** Shared tail helper: last two path segments. findDepKey keeps a residual
 *  subtree (deps may point at subfolders); repoIdentity cuts it entirely. */
function repoTail(url) {
	const s = String(url || '').replace(/\.git$/i, '').replace(/\/+$/, '');
	return s.split('/').slice(-2).join('/');
}

/** D4 (amended 2026-09-27): the manifest's DEPENDENCIES are the install
 *  authority. pnpm records a git plugin under the package's REAL name from
 *  its own package.json (e.g. '@temoa/dsh-rules-paths'), not the reff id -
 *  so matching goes by the repo's owner/name tail found in the dep's
 *  resolution (e.g. 'github:Temoa/dsh-rules-paths'), with the exact reff id
 *  as the fallback. Bundle entries are dsh's own reconcile business and MAY
 *  lag or be absent for git plugins - they are a derived hint, never the
 *  install gate. Returns the recorded dep key (the remove target) or null. */
export function findDepKey(manifest, id, repo) {
	if (manifest.deps[id] !== undefined) return id;
	// A github /tree/<ref>/ browse URL is the same repo, not a distinct plugin
	// (identity rule: repoIdentity, ADR-0016 D1); a residual subtree segment is
	// kept here because deps may legitimately point at subfolders.
	const tail = repoTail(String(repo || '').replace(/\/tree\/[^/]+(\/|$)/, '/'));
	if (!tail || tail === '/') return null;
	for (const [key, value] of Object.entries(manifest.deps)) {
		if (typeof value === 'string' && value.includes(tail)) return key;
	}
	return null;
}

/**
 * D4: the profile manifest is the install authority.
 */
export function readManifest(path) {
	if (!existsSync(path)) return { deps: {}, bundles: [], missing: true };
	const doc = JSON.parse(readFileSync(path, 'utf8'));
	return {
		deps: (doc && typeof doc === 'object' && doc.dependencies) || {},
		bundles: (doc?.dsh?.profile?.bundles) ?? [],
		missing: false
	};
}

export function isInstalled(manifest, id, repo) {
	return findDepKey(manifest, id, repo) !== null;
}

export function buildSnapshot({ reffPath, manifestPath, gardenPath, gardenRepo, profile }) {
	const warnings = [];
	const manifest = readManifest(manifestPath);
	if (manifest.missing) warnings.push({ code: 'manifest-missing', detail: manifestPath });
	const reconcile = (row) => {
		const depKey = findDepKey(manifest, row.id, row.repo);
		return { ...row, installed: depKey !== null, pkg: depKey, bundle: (depKey !== null && manifest.bundles.includes(depKey)) || null };
	};
	// Owned species first (garden scan), then external (reff) - flat rows,
	// renumbered once; sources[] groups them by repo (shelf grammar).
	const owned = scanGarden(gardenPath).map((row) => reconcile({ ...row, repo: gardenRepo ?? row.repo }));
	const parsed = existsSync(reffPath) ? parseReff(readFileSync(reffPath, 'utf8')) : { plugins: [], warnings: [] };
	warnings.push(...parsed.warnings);
	// ADR-0016 D2/D3: an external reff row whose repository the garden already
	// enumerates is SHADOWED — dropped here with a warning; the reff file itself
	// is never rewritten and parseReff output is untouched.
	const ownedIdents = new Set(owned.map((row) => repoIdentity(row.repo)));
	const external = [];
	for (const p of parsed.plugins) {
		if (ownedIdents.has(repoIdentity(p.repo))) {
			warnings.push({ code: 'reff-shadowed-by-garden', detail: p.id });
			continue;
		}
		external.push(reconcile({
			n: null,
			id: p.id,
			group: 'external',
			repo: p.repo,
			version: null,
			description: null,
			author: p.author,
			...(p.authorUrl ? { authorUrl: p.authorUrl } : {})
		}));
	}
	const plugins = [...owned, ...external].map((row, i) => ({ ...row, n: String(i + 1) }));
	// sources[]: one collapsible group per REPOSITORY (Shelf Chrome grammar),
	// keyed by repoIdentity (ADR-0016 D2) so /tree browse URLs never split a repo.
	const sources = [];
	const byRepo = new Map();
	for (const row of plugins) {
		const key = repoIdentity(row.repo);
		if (!byRepo.has(key)) {
			sources.push({
				id: key,
				name: key.split('/').pop(),
				author: row.author ?? null,
				repo: row.repo,
				plugins: []
			});
			byRepo.set(key, sources[sources.length - 1]);
		}
		byRepo.get(key).plugins.push(row);
	}
	return {
		snapshot: {
			v: CACHE_VERSION,
			generatedAt: new Date().toISOString(),
			profile,
			sources,
			plugins
		},
		warnings
	};
}

export function toInstallSpec(repo) {
	return 'git+' + repo + (repo.endsWith('.git') ? '' : '.git');
}

function resolveDshCommand(flags) {
	if (flags.dshCmd) return flags.dshCmd;
	if (process.env.DSH_WEB_CMD) return process.env.DSH_WEB_CMD;
	return 'npx --yes @deepseek-ai/dsh@latest';
}


/** Owned-species install (Plugin Garden ADR, D3): write the link dependency,
 *  APPEND (never rewrite) the bundle entry, idempotent on re-run. The only
 *  manifest write the rack performs itself - scoped to @local link species;
 *  git/npm species keep the dsh add delegation (D3). Returns the dep key. */
export function installOwned(manifestPath, row) {
	const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
	doc.dependencies = doc.dependencies ?? {};
	doc.dependencies[row.id] = row.installSpec;
	const bundles = doc.dsh && doc.dsh.profile && Array.isArray(doc.dsh.profile.bundles) ? doc.dsh.profile.bundles : [];
	if (!bundles.includes(row.id)) bundles.push(row.id);
	if (doc.dsh && doc.dsh.profile) doc.dsh.profile.bundles = bundles;
	writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
	return row.id;
}

/** Clobber guard (Plugin Garden ADR, 2026-10-07): a dsh plugin add rewrites
 *  the bundles array to just the new plugin and may drop earlier deps.
 *  Re-append every still-installed owned row's bundle entry and dep entry.
 *  Rows already recorded pass through untouched. */
export function restoreClobberedBundles(manifestPath, preOwnedRows) {
	const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
	let changed = false;
	doc.dependencies = doc.dependencies ?? {};
	const bundles = doc.dsh && doc.dsh.profile && Array.isArray(doc.dsh.profile.bundles) ? doc.dsh.profile.bundles : [];
	for (const row of preOwnedRows) {
		if (!row.pkg && !row.installSpec) continue;
		if (doc.dependencies[row.id] === undefined) {
			doc.dependencies[row.id] = row.installSpec;
			changed = true;
		}
		if (!bundles.includes(row.id)) {
			bundles.push(row.id);
			changed = true;
		}
	}
	if (doc.dsh && doc.dsh.profile) doc.dsh.profile.bundles = bundles;
	if (changed) writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
	return changed;
}

/** D3/D6: run dsh, relay its own diagnostics verbatim on failure. */
export function runDsh(flags, action, spec) {
	const cmd = resolveDshCommand(flags) + ' plugin --profile ' + flags.profile + ' ' + action + ' ' + spec;
	const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
	if (r.error) return { ok: false, error: String(r.error.message ?? r.error) };
	if (r.status !== 0) {
		const tail = ((r.stderr ?? '') + (r.stdout ?? '')).trim();
		return { ok: false, error: 'dsh plugin ' + action + ' failed (exit ' + (r.status ?? 1) + ')' + (tail ? ': ' + tail.slice(-800) : '') };
	}
	return { ok: true };
}

function loadSnapshot(cachePath) {
	const snap = JSON.parse(readFileSync(cachePath, 'utf8'));
	if (snap.v !== CACHE_VERSION) throw new Error('rack cache wire version mismatch: v=' + snap.v);
	return snap;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const reffPath = resolve(args.reff ?? join(homedir(), '.dsi/resources/plugins-reff.md'));
	const cachePath = resolve(args.cache ?? join(homedir(), '.dsi/resources/pgr-cache.json'));
	const manifestPath = resolve(args.manifest ?? join(homedir(), '.dsh/profiles', args.profile, 'package.json'));

	if (args.command === 'snapshot-status') {
		console.log(JSON.stringify({ v: CACHE_VERSION, ok: true, present: existsSync(cachePath), path: cachePath }));
		return;
	}

	if (args.command === 'refresh') {
		if (!args.reload && existsSync(cachePath)) {
			console.log(JSON.stringify({ v: CACHE_VERSION, ok: true, reused: true, snapshot: loadSnapshot(cachePath) }));
			return;
		}
		const { snapshot, warnings } = buildSnapshot({ reffPath, manifestPath, gardenPath: args.garden, gardenRepo: args.gardenRepo, profile: args.profile });
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(snapshot, null, 2));
		console.log(JSON.stringify({ v: CACHE_VERSION, ok: true, snapshot, ...(warnings.length ? { errors: warnings.map((w) => w.code + ': ' + w.detail) } : {}) }));
		return;
	}

	if (args.command === 'apply') {
		const action = args.targets.shift();
		const targets = args.targets;
		if (action !== 'install' && action !== 'remove') return fail(['apply needs install|remove and at least one target']);
		if (targets.length === 0) return fail(['apply ' + action + ' needs at least one target']);
		if (!existsSync(cachePath)) return fail(['snapshot missing, run refresh first: ' + cachePath]);
		const snap = loadSnapshot(cachePath);
		const results = [];
		for (const t of targets) {
			const plugin = snap.plugins.find((p) => p.n === t || p.id === t);
			if (!plugin) { results.push({ n: t, ok: false, error: 'not on the rack: ' + t }); continue; }
			if (action === 'install') {
				if (plugin.installed) { results.push({ n: plugin.n, id: plugin.id, ok: true, already: true }); continue; }
				if (plugin.group === 'owned') {
					// Owned species (Plugin Garden ADR, D3-scoped): link dep + bundles append + pnpm install.
					const res = installOwned(manifestPath, plugin);
					const inst = spawnSync('pnpm', ['install'], { cwd: dirname(manifestPath), encoding: 'utf8', timeout: 300000 });
					if (inst.status !== 0) { results.push({ n: plugin.n, id: plugin.id, ok: false, error: 'pnpm install failed (exit ' + (inst.status ?? 1) + '): ' + String(inst.stderr ?? '').slice(-400) }); continue; }
					plugin.installed = true;
					plugin.pkg = res;
					plugin.bundle = true;
					results.push({ n: plugin.n, id: plugin.id, pkg: res, ok: true });
					continue;
				}
				const r = runDsh(args, 'add', toInstallSpec(plugin.repo));
				if (!r.ok) { results.push({ n: plugin.n, id: plugin.id, ok: false, error: r.error }); continue; }
				const manifest = readManifest(manifestPath);
				const depKey = findDepKey(manifest, plugin.id, plugin.repo);
				if (!depKey) {
					results.push({ n: plugin.n, id: plugin.id, ok: false, error: 'dsh reported success but the manifest does not record a dependency matching ' + plugin.repo + ' (D4 authority)' });
					continue;
				}
				plugin.installed = true;
				plugin.pkg = depKey;
				plugin.bundle = manifest.bundles.includes(depKey) || null;
				results.push({ n: plugin.n, id: plugin.id, pkg: depKey, ok: true });
			} else {
				if (!plugin.installed) { results.push({ n: plugin.n, id: plugin.id, ok: false, error: 'not installed: ' + plugin.id }); continue; }
				// Remove targets the RECORDED dependency name (pnpm's truth),
				// falling back to the reff id for caches written before D4's
				// amendment - then refresh heals the manifest reconciliation.
				const manifestNow = readManifest(manifestPath);
				const depKey = findDepKey(manifestNow, plugin.pkg ?? plugin.id, plugin.repo) ?? plugin.pkg ?? plugin.id;
				const r = runDsh(args, 'remove', depKey);
				if (!r.ok) { results.push({ n: plugin.n, id: plugin.id, ok: false, error: r.error }); continue; }
				const manifest = readManifest(manifestPath);
				if (findDepKey(manifest, plugin.id, plugin.repo) !== null) {
					results.push({ n: plugin.n, id: plugin.id, ok: false, error: 'dsh reported success but the manifest still records ' + plugin.id + ' (D4 authority)' });
					continue;
				}
				plugin.installed = false;
				plugin.bundle = null;
				plugin.pkg = null;
				results.push({ n: plugin.n, id: plugin.id, ok: true });
			}
		}
		// Flip flags ONLY after every dsh call so a mid-apply failure never
		// leaves the cache half-written (shelf apply precedent).
		if (results.some((x) => x.ok && !x.already)) writeFileSync(cachePath, JSON.stringify(snap, null, 2));
		const failed = results.filter((x) => !x.ok);
		console.log(JSON.stringify({ v: CACHE_VERSION, ok: failed.length === 0, results, ...(failed.length ? { errors: failed.map((f) => f.id + ': ' + f.error) } : {}) }));
		return;
	}

	fail(['unknown command: ' + args.command + ' (use refresh | apply | snapshot-status)']);
}

function fail(errors) {
	console.log(JSON.stringify({ v: CACHE_VERSION, ok: false, errors }));
	process.exit(1);
}

// Run only when executed directly (not when imported by tests/other tools).
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) main();
