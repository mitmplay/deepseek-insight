/**
 * plugin-chain — the testable half of 'dsi dsh --plugin' (The Plugin Rack
 * ADR 2026-09-27, D3/D5): argument validation and the dsh launcher rule
 * (DSH_WEB_CMD override, else the pinned published dsh via npx — the same
 * rule runOvPlugin established). The impure half (spawnSync, killOrphans,
 * runSyncedPair) stays in dsi.mjs; this module never touches a process.
 */

/**
 * Parse 'dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' arguments.
 *
 * @param {string[]} argv
 * @param {{ envProfile?: string }} [options]
 * @returns {null | { error: string } | { action: 'add' | 'remove' | 'restart', pkg: string, profile: string }}
 *   null = argv is not a --plugin invocation (the caller falls through to
 *   its own unknown-flag error); { error } = a --plugin invocation with a
 *   bad shape (usage exit 64).
 */
export function parsePluginArgs(argv, options = {}) {
	const envProfile = options.envProfile ?? 'web';
	const [flag] = argv;
	if (flag !== '--plugin' && flag !== '--plugin-restart') return null;
	const rest = argv.slice(1);
	if (flag === '--plugin-restart') {
		if (rest.length !== 0) return { error: 'usage: dsi dsh --plugin-restart' };
		return { action: 'restart', pkg: '', profile: envProfile };
	}
	const [action, pkg, ...tail] = rest;
	if (action !== 'add' && action !== 'remove') {
		return { error: 'usage: dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' };
	}
	if (!pkg || pkg.startsWith('-')) {
		return { error: 'usage: dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' };
	}
	let profile = envProfile;
	for (let i = 0; i < tail.length; i++) {
		if (tail[i] === '--profile') {
			const value = tail[i + 1];
			if (!value || value.startsWith('-')) return { error: 'usage: --profile needs a profile name' };
			profile = value;
			i++;
		} else {
			return { error: 'unexpected argument: ' + tail[i] };
		}
	}
	return { action, pkg, profile };
}

/**
 * The dsh launcher rule (runOvPlugin's, generalized): DSH_WEB_CMD override,
 * else the pinned published dsh via npx. The webVersion pin comes from the
 * caller (dsi.mjs owns package.json reads).
 *
 * @param {string} profile
 * @param {'add' | 'remove'} action
 * @param {string} pkg
 * @param {string} webVersion
 */
export function dshLauncherCmd(profile, action, pkg, webVersion) {
	const base = process.env.DSH_WEB_CMD || 'npx --yes @deepseek-ai/dsh@' + (webVersion || 'latest');
	return base + ' plugin --profile ' + profile + ' ' + action + ' ' + pkg;
}
