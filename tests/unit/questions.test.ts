/**
 * Unit: questions util — the ONE ask_user_question parser pair shared by
 * the answerer cards and the chip-popup QuestionBlock (OCI parity,
 * 2026-08-24). Malformed input parses to honest empties, never throws.
 */
import { describe, expect, it } from 'vitest';
import { answersOutcome, parseAnswers, parseQuestions, planReviewOf } from '$lib/utils/questions';

const ARGS = {
	questions: [
		{
			id: 'q1',
			question: 'Coffee or Tea?',
			options: [{ label: 'Coffee' }, { label: 'Tea', description: 'the honest choice' }],
			header: 'DSI review',
			detail: 'pick one'
		},
		{ id: 'q2', question: 'Which parts?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }
	]
};

describe('parseQuestions', () => {
	it('parses args shape (chip argsRaw) and frame-body shape alike', () => {
		const fromArgs = parseQuestions(ARGS);
		expect(fromArgs).toHaveLength(2);
		expect(fromArgs[0].question).toBe('Coffee or Tea?');
		expect(fromArgs[0].options?.[1].description).toBe('the honest choice');
		expect(fromArgs[0].header).toBe('DSI review');
		expect(fromArgs[1].multiSelect).toBe(true);

		const fromBody = parseQuestions({ questions: ARGS.questions });
		expect(fromBody).toEqual(fromArgs);
	});

	it('malformed input → [] (no throw)', () => {
		expect(parseQuestions(undefined)).toEqual([]);
		expect(parseQuestions('junk')).toEqual([]);
		expect(parseQuestions({ questions: 'nope' })).toEqual([]);
		// Non-object entries are dropped (hard-junk filter), survivors default.
		expect(parseQuestions({ questions: [null, 7, { id: 'x' }] })).toEqual([
			{ id: 'x', question: '', header: undefined, detail: undefined, options: undefined, multiSelect: false }
		]);
	});
});

describe('parseAnswers', () => {
	it('parses the ask result payload', () => {
		const a = parseAnswers(JSON.stringify({ answers: [{ id: 'q1', selected: ['Tea'], custom: 'earl grey' }] }));
		expect(a).toEqual([{ id: 'q1', selected: ['Tea'], custom: 'earl grey' }]);
	});

	it('undefined / junk / wrong shape → []', () => {
		expect(parseAnswers(undefined)).toEqual([]);
		expect(parseAnswers('not json')).toEqual([]);
		expect(parseAnswers(JSON.stringify({ answers: 'nope' }))).toEqual([]);
		expect(parseAnswers(JSON.stringify({ answers: [null, { id: 3, selected: 'x' }] }))).toEqual([
			{ id: '', selected: [], custom: undefined }
		]);
	});
});

describe('answersOutcome', () => {
	it('joins chosen labels (and custom) per question, ·-separated', () => {
		expect(
			answersOutcome([
				{ id: 'q1', selected: ['Question text missing'] },
				{ id: 'q2', selected: ['Tool chip popup'] }
			])
		).toBe('Question text missing · Tool chip popup');
		expect(answersOutcome([{ id: 'q1', selected: [], custom: 'my own' }])).toBe('my own');
	});

	it('empty → "answered"; long lines truncate with …', () => {
		expect(answersOutcome([])).toBe('answered');
		expect(answersOutcome([{ id: 'q1', selected: ['x'.repeat(120)] }])).toMatch(/…$/);
		expect(answersOutcome([{ id: 'q1', selected: ['x'.repeat(120)] }])).toHaveLength(80);
	});
});

describe('intent passthrough (plan review card, task 1.1-T)', () => {
	it('parseQuestions preserves intent verbatim; unknown intent.kind rides through', () => {
		const parsed = parseQuestions({
			questions: [
				{
					id: 'plan-review',
					question: 'Approve this plan?',
					detail: '# Plan',
					options: [{ label: 'Approve' }, { label: 'Keep planning' }],
					intent: { kind: 'plan-review', approve: 'Approve' }
				},
				{
					id: 'q-future',
					question: 'Something else?',
					intent: { kind: 'surface-the-future', approve: 'Yes' }
				}
			]
		});
		expect(parsed[0].intent).toEqual({ kind: 'plan-review', approve: 'Approve' });
		// Unknown kinds are NOT the parser's business — they ride along unchecked.
		expect(parsed[1].intent).toEqual({ kind: 'surface-the-future', approve: 'Yes' });
	});

	it('no intent on the wire → intent stays undefined', () => {
		const parsed = parseQuestions({ questions: [{ id: 'q1', question: 'Plain?' }] });
		expect(parsed[0].intent).toBeUndefined();
	});
});

describe('planReviewOf — the six native arms (task 1.1-T)', () => {
	/** The canonical exit_plan_mode request: one question, plan markdown in
	 *  detail, Approve / Keep planning options, the plan-review intent tag. */
	function canonical(overrides: Record<string, unknown> = {}) {
		return parseQuestions({
			questions: [
				{
					id: 'plan-review',
					question: 'Approve this plan and leave plan mode?',
					header: 'Plan review',
					detail: '# The Plan\n\n1. Read the wire\n2. Render the review',
					options: [
						{ label: 'Approve', description: 'leave plan mode' },
						{ label: 'Keep planning', description: 'stay in plan mode' }
					],
					intent: { kind: 'plan-review', approve: 'Approve' },
					...overrides
				}
			]
		});
	}

	it('claims the canonical exit_plan_mode request — approve/decline are the asker’s own option objects', () => {
		const review = planReviewOf(canonical());
		expect(review).toEqual({
			id: 'plan-review',
			question: 'Approve this plan and leave plan mode?',
			plan: '# The Plan\n\n1. Read the wire\n2. Render the review',
			approve: { label: 'Approve', description: 'leave plan mode' },
			decline: { label: 'Keep planning', description: 'stay in plan mode' }
		});
	});

	it('refuses a two-question batch (arm 1: single question)', () => {
		const two = canonical();
		two.push({ id: 'q2', question: 'Second?', detail: 'd', intent: { kind: 'plan-review', approve: 'Approve' } });
		expect(planReviewOf(two)).toBeUndefined();
	});

	it('refuses a missing intent (arm 2)', () => {
		const [{ intent, ...rest }] = canonical();
		expect(intent).toBeDefined();
		expect(planReviewOf([rest])).toBeUndefined();
	});

	it('refuses an intent whose kind is not plan-review (arm 2)', () => {
		expect(planReviewOf(canonical({ intent: { kind: 'mystery', approve: 'Approve' } }))).toBeUndefined();
	});

	it('refuses a missing detail (arm 3: no plan to render)', () => {
		const [q] = canonical();
		delete (q as { detail?: string }).detail;
		expect(planReviewOf([q])).toBeUndefined();
	});

	it('refuses multiSelect (arm 4)', () => {
		expect(planReviewOf(canonical({ multiSelect: true }))).toBeUndefined();
	});

	it('refuses three options (arm 5: two buttons cannot express a third answer)', () => {
		expect(
			planReviewOf(
				canonical({
					options: [{ label: 'Approve' }, { label: 'Keep planning' }, { label: 'Ask again' }]
				})
			)
		).toBeUndefined();
	});

	it('refuses when the approve label names no option (arm 6)', () => {
		expect(planReviewOf(canonical({ intent: { kind: 'plan-review', approve: 'Ship it' } }))).toBeUndefined();
	});

	it('decline is optional: an approve-only question claims with decline undefined', () => {
		const review = planReviewOf(canonical({ options: [{ label: 'Approve', description: 'go' }] }));
		expect(review?.approve).toEqual({ label: 'Approve', description: 'go' });
		expect(review?.decline).toBeUndefined();
	});
});
