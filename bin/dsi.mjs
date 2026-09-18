#!/usr/bin/env node
// The `dsi` CLI. `dsi web` serves the SvelteKit production build (adapter-node
// output) without rebuilding — the same split as `dsh web`: `pnpm run build`
// prepares the artifacts, this launcher only runs them. The build is resolved
// relative to this file, not the cwd, so a globally installed or npx-run
// package serves its own bundled build from any directory.
// `dsi zai` bootstraps a fresh DSH install: it adds the ZAI provider and the
// default model to ~/.dsh/settings.yaml (idempotent — existing entries win).
// `dsi dsh --token <token>` copies a dsh launch token into DSI's config
// ($DSI_CONFIG_PATH or ~/.dsi/settings.yaml, key dsh.authToken — the same
// file scripts/dsh-web-synced.sh keeps fresh). `dsi dsh --sync` runs that
// script AND serves the dsi build — one foreground pair, one Ctrl-C.
// `--dev` serves the Vite dev server instead of the build (sources only).
// `dsi dsh --sync-kills` sweeps orphans a lost previous run left behind.
// `dsi dsh --ov` (or --sync --ov) installs the OpenViking memory plugin into
// the active dsh profile by delegating to `dsh plugin ... add` (idempotent).

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { mirrorSkills } from './lib/mirror-skills.mjs';

// Layman-facing help: wrapped near 76 columns, continuation lines indented,
// the recommended one-liner first. --zai is optional on purpose — no GLM
// account, no problem, the flag can simply be dropped.
const USAGE = [
	'usage: dsi <command>',
	'',
	'  Recommended first run (fetches and serves the latest DSI):',
	'',
	'      npx @deepseek-insight/dsi@latest dsh --sync --zai',
	'',
	'  One command, one window: it starts the DSH host AND the DSI page',
	'  together in the foreground — one Ctrl-C stops both. Every flag, once —',
	'  the same flag means the same thing on any command that accepts it:',
	'',
	'      --sync   sync the one-time launch token into ~/.dsi/settings.yaml,',
	'               then serve host + page as one pair',
	'      --zai    bootstrap the GLM (Z.AI) provider into ~/.dsh/settings.yaml',
	'               before anything boots. No GLM account? Skip it — drop this',
	'               flag and keep whatever provider you already configured:',
	'',
	'      npx @deepseek-insight/dsi@latest dsh --sync',
	'',
	'      --token <token>',
	'               store the dsh launch token as dsh.authToken in',
	'               ~/.dsi/settings.yaml, then serve',
	'      --dev    serve the Vite dev server instead of the built page (takes',
	'               port 5175; needs a full checkout: pnpm install)',
	'      --sync-kills',
	'               kill orphaned dsh/dsi processes left by an earlier run',
	'      --ov    install the OpenViking memory plugin into the active dsh',
	'              profile (dsh plugin ... add). Client only — the memory',
	'              server itself is set up separately (dsi-ov-setup skill)',
	'',
	'  Ports: `dsi dsh --sync` serves the DSI page on 5174 and opens your',
	'  browser there. With --dev the Vite dev server takes 5175 instead',
	'  and the browser follows. Override with PORT=<n>.',
	'',
	'  All commands (flags — see above):',
	'',
	'      dsi web [--zai] [--dev] [--token <token>]',
	'                   serve the DSI page alone (PORT env default 5174,',
	'                   HOST env default 127.0.0.1)',
	'      dsi zai      add the ZAI provider + default model to',
	'                   ~/.dsh/settings.yaml',
	'      dsi dsh --token <token>',
	'                   store the dsh launch token in ~/.dsi/settings.yaml',
	'      dsi dsh --sync [--zai] [--dev] [--ov]',
	'                   run dsh-web-synced.sh (dsh web + token sync) AND serve',
	'                   dsi — see the recommended command above',
	'      dsi dsh --ov',
	'                   install the OpenViking memory plugin into the active',
	'                   dsh profile (idempotent; alone, without --sync)',
	'      dsi dsh --sync-kills',
	'                   kill orphaned dsh/dsi processes left by an earlier run'
].join('\n');

const command = process.argv[2];
if (command === '--help' || command === '-h' || command === 'help') {
	console.log(USAGE);
	process.exit(0);
}
if (command !== 'web' && command !== 'zai' && command !== 'dsh') {
	console.error(command === undefined ? 'dsi: missing command' : `dsi: unknown command "${command}"`);
	console.error(USAGE);
	process.exit(64);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The OpenViking memory plugin DSI's host profile wants. Client-side only:
 *  it never starts openviking-server — it reconnects on its own once the
 *  server is healthy (KB 2026-09-16 §2). */
const OV_PLUGIN = '@openviking/dsh-memory-plugin';

// ── dsi zai ────────────────────────────────────────────────────────────────

/** The ZAI provider block, byte-for-byte the fresh-install shape. */
const ZAI_PROVIDER = {
	apiKeyEnv: 'ZAI_API_KEY',
	api: 'openai-completions',
	baseURL: 'https://api.z.ai/api/coding/paas/v4',
	compat: { thinkingFormat: 'zai' },
	models: [
		{ id: 'glm-4.7' },
		{ id: 'glm-5-turbo' },
		{ id: 'glm-5.1' },
		{ id: 'glm-5.2' },
		{
			id: 'glm-5.3',
			name: 'GLM-5.3',
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			input: ['text']
		},
		{
			id: 'glm-5.3-flash',
			name: 'GLM-5.3-Flash',
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			input: ['text', 'image']
		}
	]
};

/** The default-model block a fresh ZAI install wants. */
const ZAI_DEFAULT_MODEL = { provider: 'zai', model: 'glm-5.3-flash' };

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (command === 'zai') {
	addZaiProvider();
	process.exit(0);
}

// ── dsi dsh ────────────────────────────────────────────────────────────────

/** One pkill -f sweep per orphan signature. The patterns match only the
 *  process shapes this CLI and the sync script mint — the sync script, the
 *  npx-published dsh bin, the source-launched dsh bin, and the dsi server
 *  entry — so a plain sweep cannot reach unrelated processes. */
const ORPHAN_PATTERNS = [
	'dsh-web-synced.sh',
	'@deepseek-ai/dsh/lib/bin.js',
	'apps/cli/src/bin.ts web',
	'deepseek-insight/build/index.js',
	// --dev mode's UI half (scoped to the DSI checkout's vite, never a
	// foreign project's dev server).
	'deepseek-insight/node_modules/vite/bin/vite.js'
];

if (command === 'dsh') {
	const flag = process.argv[3];
	if (flag === '--token') {
		const token = process.argv[4];
		if (token === undefined || token === '') {
			console.error('dsi dsh: --token needs the launch token as its value');
			process.exit(64);
		}
		setDshAuthToken(token);
		process.exit(0);
	}
	if (flag === '--ov') {
		runOvPlugin();
		process.exit(0);
	}
	if (flag === '--sync') {
		// --zai and --dev are dsi-side flags, stripped from the args the sync
		// script forwards to `dsh web` (which would refuse them):
		// --zai bootstraps the ZAI provider BEFORE the host boots, so the fresh
		// settings are picked up by this very run.
		// --dev serves the Vite dev server instead of the built UI — the same
		// HMR surface as `pnpm dev`, beside the same synced host.
		const rest = process.argv.slice(4);
		const withZai = rest.includes('--zai');
		const withDev = rest.includes('--dev');
		const withOv = rest.includes('--ov');
		if (withZai) addZaiProvider();
		if (withOv) runOvPlugin();
		runSkillsMirror();
		runSyncedPair(
			rest.filter((arg) => arg !== '--zai' && arg !== '--dev' && arg !== '--ov'),
			withDev
		);
	} else if (flag === '--sync-kills') {
		killOrphans();
		process.exit(0);
	} else {
		console.error(flag === undefined ? 'dsi dsh: missing flag (--token <token> | --sync | --sync-kills)' : `dsi dsh: unknown flag "${flag}"`);
		console.error(USAGE);
		process.exit(64);
	}
}

/** Config file resolution matches DSI's reader and dsh-web-synced.sh
 *  exactly: $DSI_CONFIG_PATH or ~/.dsi/settings.yaml — the LIVE config
 *  (config.json is the migrated-from legacy file, never read again). */
function dsiConfigPath() {
	return process.env.DSI_CONFIG_PATH ?? path.join(homedir(), '.dsi', 'settings.yaml');
}

/** Store a dsh launch token as dsh.authToken. Same-file semantics as the
 *  sync script: merge into the existing dsh section, atomic tmp+rename
 *  write. A byte-identical token is a no-op (no mtime churn). Exits
 *  non-zero when the file exists but is not parseable YAML. The token is
 *  never echoed — argv exposure is the caller's choice, output stays clean. */
function setDshAuthToken(token) {
	const configPath = dsiConfigPath();

	let doc = {};
	if (existsSync(configPath)) {
		try {
			const parsed = parse(readFileSync(configPath, 'utf-8'));
			if (!isRecord(parsed)) throw new Error('not a YAML mapping');
			doc = parsed;
		} catch (error) {
			console.error(`dsi dsh: cannot parse ${configPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}

	const current = isRecord(doc['dsh']) ? doc['dsh'].authToken : undefined;
	if (current === token) {
		console.log(`dsi dsh: ${configPath} already has this authToken — nothing to do`);
		return;
	}
	doc['dsh'] = { ...(isRecord(doc['dsh']) ? doc['dsh'] : {}), authToken: token };

	mkdirSync(path.dirname(configPath), { recursive: true });
	const temp = `${configPath}.${process.pid}.tmp`;
	writeFileSync(temp, stringify(doc), 'utf-8');
	renameSync(temp, configPath);
	// Tilde-compress $HOME so the log line stays portable (no /Users/<you> leak).
	console.log(`dsi dsh: authToken updated in ${configPath.startsWith(homedir()) ? `~${configPath.slice(homedir().length)}` : configPath}`);
}

/** The pinned published dsh version for `dsi dsh --sync`, from this
 *  package.json's dsh.webVersion (empty when absent — the sync script then
 *  falls back to the registry's latest tag). An exact pin, not a range: a
 *  range drifts to whatever the registry resolves, and the pin exists
 *  precisely because latest can change the API contract under DSI. */
function dshWebVersion() {
	const doc = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'));
	const version = doc?.dsh?.webVersion;
	return typeof version === 'string' && version !== '' ? version : 'latest';
}

/** True when something is already listening on 127.0.0.1:port. Probed with
 *  Node's own net stack — no lsof/ss/netstat needed, so it behaves the same
 *  on macOS and Linux. Returns false on any other probe error (the host's
 *  own boot error is the honest reporter in that case). */
function portInUse(port) {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once('error', (error) => resolve(error.code === 'EADDRINUSE'));
		probe.once('listening', () => probe.close(() => resolve(false)));
		probe.listen(port, '127.0.0.1');
	});
}

/** The dsh host hard-fails on a busy 3080 with a long Cordis stack; catch
 *  it before the pair spawns. First sweep the known orphan shapes
 *  (pkill -f — same BSD/procps flag set on macOS and Linux), wait for the
 *  socket to actually free, then give up with a one-line hint if something
 *  foreign still holds the port. */
async function preflightPort(port, label) {
	if (!(await portInUse(port))) return;
	console.log(`dsi dsh: port ${port} (${label}) is busy — sweeping orphaned dsh/dsi processes`);
	killOrphans();
	for (let waited = 0; waited < 5000; waited += 250) {
		if (!(await portInUse(port))) {
			console.log(`dsi dsh: port ${port} is free — continuing`);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error(`dsi dsh: port ${port} (${label}) is still in use by a process the sweep does not own — free it yourself, then re-run`);
	process.exit(64);
}

/** Open the default browser at url once the pair has had a moment to boot.
 *  Best-effort only: a missing or failing opener never disturbs the pair —
 *  the URL is already on screen in the logs. Detached + unref: the opener
 *  is fire-and-forget and must not hold this process alive. */
function openBrowser(url, delayMs = 2000) {
	setTimeout(() => {
		const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
		try {
			spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
		} catch {
			// no opener on this host — the printed URL is the fallback
		}
	}, delayMs);
}

/** Run the PAIR in the foreground: scripts/dsh-web-synced.sh (dsh web plus
 *  the live token watcher) as the host, then the dsi build — or, with dev,
 *  the Vite dev server (`pnpm dev`'s surface) — as the UI. The pair shares
 *  one lifecycle — a signal or one child's exit tears down the other, so no
 *  orphan survives a Ctrl-C or a crash. */
async function runSyncedPair(extraArgs, dev = false) {
	const script = path.join(packageRoot, 'scripts', 'dsh-web-synced.sh');
	if (!existsSync(script)) {
		console.error(`dsi dsh: no sync script at ${script}`);
		process.exit(66);
	}
	// UI port: the built server takes 5174 — the same port `dsi web` uses,
	// so plain `dsi dsh --sync` listens on ONE port. --dev's Vite dev server
	// takes 5175 instead (vite.config.ts pins 5174 strictPort, so pair mode
	// passes 5175 explicitly), giving the two-port dev shape.
	const uiPort = process.env.PORT ?? (dev ? '5175' : '5174');
	// Preflight BOTH halves: a forgotten previous run holds not just the
	// host's 3080 but often the UI port too — the host would only crash
	// later, and the UI server would crash first with EADDRINUSE.
	await preflightPort(3080, 'dsh host');
	await preflightPort(uiPort, 'DSI page');
	const host = spawn('/bin/sh', [script, ...extraArgs], {
		stdio: 'inherit',
		env: { ...process.env, DSH_WEB_VERSION: dshWebVersion() }
	});
	const ui = dev ? startDsiDevServer(uiPort) : startDsiServer(uiPort);
	// The browser follows the UI: the built page (5174) — or, in --dev mode,
	// the dev server (5175).
	openBrowser(`http://localhost:${uiPort}/`);
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			host.kill(signal);
			ui.kill(signal);
		});
	}
	const teardown = (code, signal) => {
		host.kill('SIGTERM');
		ui.kill('SIGTERM');
		process.exit(signal ? 1 : (code ?? 1));
	};
	host.on('exit', teardown);
	ui.on('exit', teardown);
}

/** Kill orphaned dsh/dsi leftovers — a pair whose parent died before it
 *  could tear down its sibling, or a previous run the terminal lost. */
function killOrphans() {
	for (const pattern of ORPHAN_PATTERNS) {
		try {
			spawnSync('pkill', ['-f', pattern], { stdio: 'pipe' });
		} catch {
			// pkill missing is only possible on a non-POSIX host; the next
			// pattern's try still runs and the report below stays honest.
		}
	}
	console.log('dsi dsh: orphan sweep done (dsh-web-synced.sh, dsh bin, dsi server)');
}

/** Add the ZAI provider and default model to ~/.dsh/settings.yaml when
 *  absent. Existing entries always win — an already-configured host is
 *  rewritten only when at least one block was added. Exits non-zero when
 *  the settings file exists but is not parseable YAML. */
function addZaiProvider() {
	const settingsPath =
		process.env.DSH_SETTINGS_PATH ?? path.join(homedir(), '.dsh', 'settings.yaml');

	let doc = {};
	if (existsSync(settingsPath)) {
		try {
			const parsed = parse(readFileSync(settingsPath, 'utf-8'));
			if (!isRecord(parsed)) throw new Error('not a YAML mapping');
			doc = parsed;
		} catch (error) {
			console.error(`dsi zai: cannot parse ${settingsPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}

	const added = [];
	if (!isRecord(doc['llm-pi-ai']) || !isRecord(doc['llm-pi-ai'].providers)) {
		doc['llm-pi-ai'] = { providers: {} };
	}
	if (!isRecord(doc['llm-pi-ai'].providers.zai)) {
		doc['llm-pi-ai'].providers.zai = ZAI_PROVIDER;
		added.push('llm-pi-ai.providers.zai');
	}
	if (doc['agent-default-model'] === undefined) {
		doc['agent-default-model'] = ZAI_DEFAULT_MODEL;
		added.push('agent-default-model');
	}

	if (added.length === 0) {
		console.log(`dsi zai: ${settingsPath} already has the ZAI provider — nothing to do`);
		return;
	}

	mkdirSync(path.dirname(settingsPath), { recursive: true });
	const temp = `${settingsPath}.${process.pid}.tmp`;
	writeFileSync(temp, stringify(doc), 'utf-8');
	renameSync(temp, settingsPath);
	for (const entry of added) console.log(`dsi zai: added ${entry}`);
	console.log(`dsi zai: ${settingsPath} updated — set ZAI_API_KEY in the harness env, then restart dsh web`);
}

/** Install the OpenViking memory plugin into the active dsh profile by
 *  delegating to `dsh plugin --profile <profile> add` — the same dsh
 *  launcher `dsi dsh --sync` uses (DSH_WEB_CMD override, else the published
 *  pin via npx). dsh's own reconcilePlugins appends the package to
 *  dsh.profile.bundles (it declares a dsh.bundle), so nothing is hand-edited
 *  here. Idempotent: a profile that already has the dependency AND the bundle
 *  entry skips the pnpm round-trip. Fail-loud: a nonzero child exit (or a
 *  missing pnpm — dsh exits 127 for it) propagates. */
function runOvPlugin() {
	const profile = process.env.DSH_PROFILE ?? 'web';
	const manifestPath = path.join(
		homedir(), '.dsh', 'profiles', profile, 'package.json'
	);
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
			const deps = manifest?.dependencies ?? {};
			const bundles = manifest?.dsh?.profile?.bundles ?? [];
			if (deps[OV_PLUGIN] !== undefined && bundles.includes(OV_PLUGIN)) {
				console.log(`dsi dsh: ${OV_PLUGIN} already installed in the ${profile} profile — nothing to do`);
				return;
			}
		} catch (error) {
			console.error(`dsi dsh: cannot parse ${manifestPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}
	const cmd = process.env.DSH_WEB_CMD
		? `${process.env.DSH_WEB_CMD} plugin --profile ${profile} add ${OV_PLUGIN}`
		: `npx --yes @deepseek-ai/dsh@${dshWebVersion()} plugin --profile ${profile} add ${OV_PLUGIN}`;
	console.log(`dsi dsh: installing ${OV_PLUGIN} into the ${profile} profile (${cmd})`);
	const result = spawnSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' });
	if (result.error !== undefined) throw result.error;
	const code = result.status ?? 1;
	if (code !== 0) {
		console.error(`dsi dsh: plugin install failed (exit ${code}) — pnpm on PATH is required; fix the cause above, then re-run`);
		process.exit(code);
	}
	console.log(`dsi dsh: ${OV_PLUGIN} installed — it connects on its own once openviking-server answers (see the dsi-ov-setup skill for the server side)`);
}

/** Plant the shipped skills into the operator's skill mirror
 *  (~/.agents/skills) — ADR "The Skill Mirror" 2026-09-15, D1–D5:
 *  per-skill copy-only-if-absent, every repo skill, failures warn and
 *  never block the launch. Silent when nothing was copied or warned. */
function runSkillsMirror() {
	const report = mirrorSkills(
		path.join(packageRoot, '.agents', 'skills'),
		path.join(homedir(), '.agents', 'skills')
	);
	for (const name of report.warned) {
		console.error(`dsi: skills mirror — could not copy ${name} (skipping)`);
	}
	if (report.copied.length > 0 || report.warned.length > 0) {
		console.log(`dsi: skills mirror — ${report.copied.length} copied, ${report.skipped.length} skipped, ${report.warned.length} warned`);
	}
}

// ── dsi web ────────────────────────────────────────────────────────────────

/** Spawn the built server (adapter-node output): the one child `dsi web`
 *  serves in the foreground, and the UI half of the `dsi dsh --sync` pair
 *  (runSyncedPair passes its uiPort explicitly). Port truth: `dsh web` —
 *  the pair's host half — binds 3080 (packages/boot/cmdline default), so
 *  the UI's `PORT ?? 5174` never fights it. */
/** Spawn the Vite dev server — --dev mode's UI half, the same surface as
 *  `pnpm dev` (vite.config.ts pins port 5174 strictPort, so pair mode passes
 *  --port 5175 explicitly; a taken port fails loud, never a silent fallback).
 *  Dev mode runs SOURCES from the checkout, so it is only valid where the
 *  sources and devDependencies exist — a published tarball (bin + build)
 *  refuses loudly instead of half-booting. The --port CLI flag overrides the
 *  config's server.port while strictPort keeps the fail-loud contract. */
function startDsiDevServer(defaultPort = '5175') {
	const viteBin = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
	if (!existsSync(viteBin)) {
		console.error(`dsi dsh --dev: no vite at ${viteBin} — --dev needs a full DSI checkout (pnpm install); use the built server instead`);
		process.exit(66);
	}
	// --host matches the built server's 127.0.0.1 bind: vite's default
	// 'localhost' can resolve ::1-only and strand a 127.0.0.1 client.
	return spawn(process.execPath, [viteBin, 'dev', '--host', process.env.HOST ?? '127.0.0.1', '--port', process.env.PORT ?? defaultPort], {
		stdio: 'inherit',
		cwd: packageRoot,
		env: {
			...process.env,
			// Same first-start bootstrap seam as the built server.
			DSI_TEMPLATE_PATH: process.env.DSI_TEMPLATE_PATH ?? path.join(packageRoot, 'template', '.dsi')
		}
	});
}

function startDsiServer(defaultPort = '5174') {
	const serverEntry = path.join(packageRoot, 'build', 'index.js');
	if (!existsSync(serverEntry)) {
		console.error(`dsi: no build found at ${serverEntry} — run \`pnpm run build\` first`);
		process.exit(66);
	}
	return spawn(process.execPath, [serverEntry], {
		stdio: 'inherit',
		env: {
			...process.env,
			PORT: process.env.PORT ?? defaultPort,
			HOST: process.env.HOST ?? '127.0.0.1',
			// First-start bootstrap seam: the server clones template/.dsi to ~/.dsi
			// when the operator home is absent (src/lib/server/settings-document.ts).
			DSI_TEMPLATE_PATH: process.env.DSI_TEMPLATE_PATH ?? path.join(packageRoot, 'template', '.dsi')
		}
	});
}

// The web command ends the script — and MUST fall off here, not dsh's:
// before this guard existed, `dsi dsh --sync` fell through to the web
// launcher below and spawned a SECOND build server on the same 5174 the
// pair had already taken. One printed "Listening on", the other crashed
// EADDRINUSE, the crash child's exit handler killed this launcher, and the
// fresh pair was orphaned in the background (RCA 2026-09-14).
if (command === 'web') {
	// Optional dsi-side flags, the same meanings as `dsi dsh --sync`: --zai
	// bootstraps the ZAI provider BEFORE anything boots (so this run picks it
	// up), --token stores the dsh launch token before the page serves, --dev
	// swaps the built server for the Vite dev server. Everything is done
	// first, then the one child spawns and the script falls off the end.
	const rest = process.argv.slice(3);
	const withZai = rest.includes('--zai');
	const withDev = rest.includes('--dev');
	const tokenIdx = rest.indexOf('--token');
	let token;
	if (tokenIdx !== -1) {
		token = rest[tokenIdx + 1];
		if (token === undefined || token === '' || token.startsWith('--')) {
			console.error('dsi web: --token needs the launch token as its value');
			process.exit(64);
		}
	}
	const unknown = rest.filter((arg, i) =>
		arg !== '--zai' && arg !== '--dev'
		&& arg !== '--token' && !(tokenIdx !== -1 && i === tokenIdx + 1)
	);
	if (unknown.length > 0) {
		console.error(`dsi web: unknown flag "${unknown[0]}"`);
		console.error(USAGE);
		process.exit(64);
	}
	if (withZai) addZaiProvider();
	if (token !== undefined) setDshAuthToken(token);
	runSkillsMirror();
	const child = withDev ? startDsiDevServer() : startDsiServer();

	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			child.kill(signal);
		});
	}
	child.on('exit', (code, signal) => {
		process.exit(signal ? 1 : (code ?? 1));
	});
}
