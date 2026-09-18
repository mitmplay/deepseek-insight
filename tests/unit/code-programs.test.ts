/**
 * code-programs unit tests — the run_code parser (ADR-0008): args →
 * {code, description, plan}, the tool-plan scan against the patterns
 * observed in session 1fe381df (P1 shim / P2 batch / P3 heredoc),
 * junk honesty (undefined, never throws, never a wrong plan).
 */

import { describe, expect, it } from 'vitest';
import { codeProgramPreview, isRunCodeTool, parseCodeProgram, planStepTitle } from '$lib/utils/code-programs';

/** Wire-shaped args builder (tool/call.data.arguments). */
function rcArgs(code: string, description?: string): string {
	return JSON.stringify({ ...(description !== undefined ? { description } : {}), code });
}

describe('isRunCodeTool', () => {
	it('matches exactly the wire name', () => {
		expect(isRunCodeTool('run_code')).toBe(true);
		expect(isRunCodeTool('bash')).toBe(false);
		expect(isRunCodeTool('run_codes')).toBe(false);
	});
});

describe('parseCodeProgram — P1 thin shim (67% of session 1fe381df)', () => {
	it('parses the real first-wire example: description + one read step with basename', () => {
		const code = 'const f = await tools.read({ file_path: "/a/b/InlineToolCalls.svelte" });\nconsole.log(f.lines.length);';
		expect(parseCodeProgram(rcArgs(code, 'Read InlineToolCalls component source'))).toEqual({
			code,
			description: 'Read InlineToolCalls component source',
			plan: [{ tool: 'read', arg: 'InlineToolCalls.svelte' }]
		});
	});

	it('a code-only program (no description member) parses with plan only', () => {
		const code = 'const r = await tools.bash({ command: "ls", description: "x" });';
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.description).toBeUndefined();
		expect(p?.plan).toEqual([{ tool: 'bash', arg: 'ls' }]);
	});
});

describe('parseCodeProgram — P2 sequenced batch', () => {
	it('scans tool calls in source order with salient args', () => {
		const code = [
			'const a = await tools.read({ file_path: "/tmp/one.ts" });',
			'const g = await tools.grep({ pattern: "ToolCallDetail", path: "/src" });',
			'const r = await tools.bash({ command: "pnpm vitest run\nexit 0", description: "run" });'
		].join('\n');
		const p = parseCodeProgram(rcArgs(code, 'Three steps'));
		expect(p?.plan).toEqual([
			{ tool: 'read', arg: 'one.ts' },
			{ tool: 'grep', arg: 'ToolCallDetail' },
			{ tool: 'bash', arg: 'pnpm vitest run' } // first line only
		]);
	});

	it('braces inside strings do not end the args object early', () => {
		const code = 'await tools.grep({ pattern: "{code, description}?" });';
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.plan).toEqual([{ tool: 'grep', arg: '{code, description}?' }]);
	});

	it('salient args keep their first line, uncapped — capping is a surface concern', () => {
		const long = 'x'.repeat(80);
		const code = `await tools.bash({ command: "${long}\\nsecond line" });`;
		const p = parseCodeProgram(rcArgs(code));
		expect(p?.plan[0]?.arg).toBe(long); // first line, full width
	});
});

describe('parseCodeProgram — honesty', () => {
	it('junk, non-object, and missing-code args parse to undefined', () => {
		expect(parseCodeProgram(undefined)).toBeUndefined();
		expect(parseCodeProgram('{not json')).toBeUndefined();
		expect(parseCodeProgram('"text"')).toBeUndefined();
		expect(parseCodeProgram('[]')).toBeUndefined();
		expect(parseCodeProgram('{"description":"no code"}')).toBeUndefined();
		expect(parseCodeProgram('{"code":""}')).toBeUndefined();
	});

	it('pure-logic programs scan to an empty plan; unclosed calls are skipped', () => {
		expect(parseCodeProgram(rcArgs('console.log(1); return 2;'))?.plan).toEqual([]);
		expect(parseCodeProgram(rcArgs('const x = tools.run('))?.plan).toEqual([]);
	});

	it('plan is bounded (MAX_PLAN_STEPS)', () => {
		const code = Array.from({ length: 12 }, (_, i) => `await tools.read({ file_path: "/f${i}" });`).join('\n');
		expect(parseCodeProgram(rcArgs(code))?.plan).toHaveLength(8);
	});
});

describe('planStepTitle — chip vocabulary, raw name for unknowns', () => {
	it('known tools use the variant title; unknown keep the wire name', () => {
		expect(planStepTitle('bash')).toBe('Bash');
		expect(planStepTitle('read')).toBe('Read');
		expect(planStepTitle('todo_write')).toBe('todo_write');
	});
});

describe('codeProgramPreview — the peek one-liner ladder (session 1fe381df evidence)', () => {
	it('description wins when present', () => {
		const code = 'await tools.read({ file_path: "/a.ts" });';
		expect(codeProgramPreview(rcArgs(code, 'Read the file'))).toBe('Read the file');
	});

	it('the schema-error retries (no description) show the first plan step, not the code head', () => {
		// seq 541 wire shape: complete single-line bash shim, no description
		// member (the omission IS the error), red result on the chip.
		const code = 'const r = await tools.bash({ command: "pwd; echo ---; ls -la ~/agentic-ai 2>/dev/null | head -30; echo ---; ls ~/openclaw-insight" });';
		const command = 'pwd; echo ---; ls -la ~/agentic-ai 2>/dev/null | head -30; echo ---; ls ~/openclaw-insight';
		expect(codeProgramPreview(rcArgs(code))).toBe('Bash ' + command); // full — under the peek cap, no early ellipsis
	});

	it('a plan step without a salient arg shows the title alone', () => {
		expect(codeProgramPreview(rcArgs('await tools.todo_write({ todos: [] });'))).toBe('todo_write');
	});

	it('no description, no plan → first code line, capped at 120', () => {
		expect(codeProgramPreview(rcArgs('console.log(1); return 2;'))).toBe('console.log(1); return 2;');
		const line = 'console.log("' + 'x'.repeat(200) + '");';
		expect(codeProgramPreview(rcArgs(line))).toBe(line.slice(0, 120) + '…'); // truncate keeps max, ellipsis rides after
	});

	it('every rung caps at 120 — a pathologically long description too', () => {
		expect(codeProgramPreview(rcArgs('return 1;', 'd'.repeat(150)))).toBe('d'.repeat(120) + '…');
	});

	it('junk and missing args parse to empty (caller falls to the raw preview)', () => {
		expect(codeProgramPreview(undefined)).toBe('');
		expect(codeProgramPreview('{not json')).toBe('');
	});
});
