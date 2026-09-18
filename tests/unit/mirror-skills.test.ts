/**
 * mirror-skills unit tests — the launcher's skill-planting step
 * (ADR "The Skill Mirror" 2026-09-15, D1/D4/D5). Temp dirs only; no
 * network, no ~/.agents access.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mirrorSkills } from '../../bin/lib/mirror-skills.mjs';

let root: string;

function makeSource(skills: Record<string, string>): string {
	const src = join(root, 'src-skills');
	for (const [name, text] of Object.entries(skills)) {
		const dir = join(src, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'SKILL.md'), text, 'utf-8');
	}
	return src;
}

function makeMirror(): string {
	const mirror = join(root, 'mirror');
	mkdirSync(mirror, { recursive: true });
	return mirror;
}

afterEach(() => {
	if (root) {
		// restore any read-only perms so cleanup can recurse
		try {
			chmodSync(join(root, 'mirror'), 0o755);
		} catch {
			/* not created this test */
		}
		rmSync(root, { recursive: true, force: true });
	}
});

describe('mirrorSkills — the launcher skill-planting step', () => {
	it('AC1: copies absent skills recursively, byte-identical', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const src = makeSource({ 'dsi-adr': '# ADR skill\nbody' });
		const mirror = makeMirror();
		const report = mirrorSkills(src, mirror);
		expect(report.copied).toEqual(['dsi-adr']);
		expect(report.skipped).toEqual([]);
		expect(report.warned).toEqual([]);
		expect(readFileSync(join(mirror, 'dsi-adr', 'SKILL.md'), 'utf-8')).toBe('# ADR skill\nbody');
	});

	it('AC2: an existing target always wins — the source is not copied over it', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const src = makeSource({ 'dsi-adr': 'repo version' });
		const mirror = makeMirror();
		const target = join(mirror, 'dsi-adr');
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, 'SKILL.md'), 'OPERATOR-MARKER', 'utf-8');
		const report = mirrorSkills(src, mirror);
		expect(report.skipped).toEqual(['dsi-adr']);
		expect(report.copied).toEqual([]);
		expect(readFileSync(join(target, 'SKILL.md'), 'utf-8')).toBe('OPERATOR-MARKER');
	});

	it('AC3: an unrelated mirror entry an empty target dir is skipped, never rebuilt', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const src = makeSource({ 'dsi-spec': 'spec skill' });
		const mirror = makeMirror();
		mkdirSync(join(mirror, 'unrelated-skill'), { recursive: true });
		writeFileSync(join(mirror, 'unrelated-skill', 'note.txt'), 'keep me', 'utf-8');
		mkdirSync(join(mirror, 'dsi-spec'), { recursive: true }); // exists, even empty
		const report = mirrorSkills(src, mirror);
		expect(report.skipped).toEqual(['dsi-spec']);
		expect(existsSync(join(mirror, 'unrelated-skill', 'note.txt'))).toBe(true);
	});

	it('AC4: a missing source dir is a silent no-op report', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const mirror = makeMirror();
		const report = mirrorSkills(join(root, 'nope'), mirror);
		expect(report).toEqual({ copied: [], skipped: [], warned: [] });
	});

	it('AC4b: stray files in the source are ignored — only directories are skills', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const src = makeSource({ 'dsi-task': 'task skill' });
		writeFileSync(join(src, 'stray.txt'), 'not a skill', 'utf-8');
		const mirror = makeMirror();
		const report = mirrorSkills(src, mirror);
		expect(report.copied).toEqual(['dsi-task']);
		expect(existsSync(join(mirror, 'stray.txt'))).toBe(false);
	});

	it('D5: an unwritable mirror records warns and never throws', () => {
		root = mkdtempSync(join(tmpdir(), 'mirror-skills-'));
		const src = makeSource({ 'dsi-adr': 'x' });
		const mirror = makeMirror();
		chmodSync(mirror, 0o555); // read-only
		try {
			const report = mirrorSkills(src, mirror);
			expect(report.warned).toEqual(['dsi-adr']);
			expect(report.copied).toEqual([]);
		} finally {
			chmodSync(mirror, 0o755);
		}
	});
});
