import { describe, expect, it, vi } from 'vitest';
import { resolveFileLinkPath, resolveFileLinkTarget } from '../../src/lib/utils/file-link';

// Operator question (2026-10-11): does the resolver cover ALL three link
// shapes against a session workspace root of ~/agentic-ai?
const ROOT = '~/agentic-ai';
const REL = 'dev/architectural-decission/2026-10/2026-10-10 - ADR-0023.md';
const PATH_A = REL;
const PATH_B = 'deepseek-insight/' + REL;
const PATH_C = '/Users/wharsojo/agentic-ai/' + REL;
const PATH_T = '~/agentic-ai/' + REL;

const exists = vi.fn(async (_sid: string, p: string) => p === PATH_B);
const listRoot = vi.fn(async () => ['deepseek-insight', 'other-repo', 'notes']);

describe('file-link shapes vs root ~/agentic-ai (operator question 2026-10-11)', () => {
	it('a) missing repo folder is repaired by the deep fallback', async () => {
		const target = await resolveFileLinkTarget('s1', PATH_A, ROOT, exists, listRoot);
		expect(target).toBe(PATH_B);
	});
	it('b) repo-folder-relative is already workspace-relative — kept as-is', () => {
		// the root is ~/agentic-ai, so deepseek-insight/dev/... IS the
		// workspace-relative truth; stripping would be wrong here
		expect(resolveFileLinkPath(PATH_B, ROOT)).toBe(PATH_B);
	});
	it('b-probe) and the full resolver lands on the real file', async () => {
		const target = await resolveFileLinkTarget('s1', PATH_B, ROOT, exists, listRoot);
		expect(target).toBe(PATH_B);
	});
	it('c) expanded full path is stripped via the root match / segment marker', async () => {
		const target = await resolveFileLinkTarget('s1', PATH_C, ROOT, exists, listRoot);
		expect(target).toBe(PATH_B);
	});
	it('c-tilde) unexpanded root with tilde full path resolves via tilde strip + marker', async () => {
		const target = await resolveFileLinkTarget('s1', PATH_T, ROOT, exists, listRoot);
		expect(target).toBe(PATH_B);
	});
	it('a-as-is) the shape keeps its as-is identity for the fallback to prefix', () => {
		expect(resolveFileLinkPath(PATH_A, ROOT)).toBe(PATH_A);
	});
});
