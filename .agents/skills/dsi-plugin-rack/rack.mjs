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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CACHE_VERSION = 1;

function parseArgs(argv) {
	const out = { command: argv[0], reload: false, reff: null, cache: null, manifest: null, profile: process.env.DSH_PROFILE ?? 'web', dshCmd: null, targets: [] };
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--reload') out.reload = true;
		else if (a === '--reff') out.reff = argv[++i];
		else if (a === '--cache') out.cache = argv[++i];
		else if (a === '--manifest') out.manifest = argv[++i];
		else if (a === '--profile') out.profile = argv[++i];
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
	const tail = String(repo || '').replace(/\\.git$/, '').replace(/\/+$/, '').split('/').slice(-2).join('/');
	if (!tail) return null;
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

export function buildSnapshot({ reffPath, manifestPath, profile }) {
	const warnings = [];
	if (!existsSync(reffPath)) warnings.push({ code: 'reff-missing', detail: reffPath });
	const parsed = existsSync(reffPath) ? parseReff(readFileSync(reffPath, 'utf8')) : { plugins: [], warnings: [] };
	warnings.push(...parsed.warnings);
	const manifest = readManifest(manifestPath);
	if (manifest.missing) warnings.push({ code: 'manifest-missing', detail: manifestPath });
	return {
		snapshot: {
			v: CACHE_VERSION,
			generatedAt: new Date().toISOString(),
			profile,
			plugins: parsed.plugins.map((p, i) => {
				const depKey = findDepKey(manifest, p.id, p.repo);
				return {
					n: String(i + 1),
					id: p.id,
					repo: p.repo,
					author: p.author,
					...(p.authorUrl ? { authorUrl: p.authorUrl } : {}),
					installed: depKey !== null,
					// The recorded dependency name (pnpm's truth) - the remove target.
					pkg: depKey,
					bundle: (depKey !== null && manifest.bundles.includes(depKey)) || null
				};
			})
		},
		warnings
	};
}

/** D3: the reff URL becomes the dsh add spec: git+<url>.git (append .git
 *  only when absent — the operator's line stays the single source). */
export function toInstallSpec(repo) {
	return 'git+' + repo + (repo.endsWith('.git') ? '' : '.git');
}

function resolveDshCommand(flags) {
	if (flags.dshCmd) return flags.dshCmd;
	if (process.env.DSH_WEB_CMD) return process.env.DSH_WEB_CMD;
	return 'npx --yes @deepseek-ai/dsh@latest';
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
		const { snapshot, warnings } = buildSnapshot({ reffPath, manifestPath, profile: args.profile });
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

main();
