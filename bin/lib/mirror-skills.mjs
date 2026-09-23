// skills-mirror — plant DSI's shipped skills into the operator's skill
// mirror (~/.agents/skills). Per-skill, copy-only-if-absent: an existing
// target ALWAYS wins (ADR "The Skill Mirror" 2026-09-15, D1), the whole
// source set is copied (D4), and any per-skill failure is recorded as a
// warning instead of throwing (D5). Zero dependencies: node built-ins only.
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy every skill directory from sourceDir into mirrorDir whose target is
 * absent. Never throws: failures land in the report's warned list.
 * @param {string} sourceDir - e.g. <packageRoot>/.agents/skills
 * @param {string} mirrorDir - e.g. ~/.agents/skills
 * @returns {{copied: string[], skipped: string[], warned: string[]}}
 */
export function mirrorSkills(sourceDir, mirrorDir) {
	const report = /** @type {{copied: string[], skipped: string[], warned: string[]}} */ ({ copied: [], skipped: [], warned: [] });
	let sourceIsDir = false;
	try {
		sourceIsDir = existsSync(sourceDir) && statSync(sourceDir).isDirectory();
	} catch {
		return report;
	}
	if (!sourceIsDir) return report;

	let entries = [];
	try {
		entries = readdirSync(sourceDir);
	} catch {
		return report;
	}

	for (const name of entries) {
		const source = join(sourceDir, name);
		let isDir = false;
		try {
			isDir = statSync(source).isDirectory();
		} catch {
			continue; // unreadable source entry — not this run's problem
		}
		if (!isDir) continue; // stray files are not skills

		const target = join(mirrorDir, name);
		if (existsSync(target)) {
			report.skipped.push(name); // existing wins — D1
			continue;
		}
		try {
			cpSync(source, target, { recursive: true });
			report.copied.push(name);
		} catch {
			report.warned.push(name); // D5: warn, continue, never throw
		}
	}
	return report;
}
