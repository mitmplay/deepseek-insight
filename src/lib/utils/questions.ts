/**
 * ask_user_question arg/result parsing — the ONE parser shared by every
 * surface that renders the question tool's payloads (OCI QuestionBlock
 * parity, 2026-08-24): the answerer cards (wire frame body), the chip
 * popup (ledger argsRaw/resultText), and any future surface. Malformed
 * input parses to [] — display honest empties, never throw.
 */

/** One question in the batch (AskUserQuestionItem, wire-verbatim subset). */
export interface QItem {
	id: string;
	question: string;
	detail?: string;
	header?: string;
	options?: QOption[];
	multiSelect?: boolean;
	/** The asker's presentation intent, carried through verbatim — unknown
	 *  kinds ride along; planReviewOf, not the parser, decides what they
	 *  claim (mirrors the DSH plan-mode tag). */
	intent?: { kind: string; approve?: string };
}

/** One option of a question (wire-verbatim subset). */
export interface QOption {
	label: string;
	description?: string;
}

/** One answered question of a batch (ask result, wire-verbatim subset). */
export interface QAnswer {
	id: string;
	selected: string[];
	custom?: string;
}

/**
 * Parse a questions array (ask_user_question args, or the answerer
 * frame's body — same shape) into card items.
 */
export function parseQuestions(body: unknown): QItem[] {
	if (body === null || typeof body !== 'object') return [];
	const raw = Array.isArray((body as { questions?: unknown }).questions)
		? ((body as { questions: unknown[] }).questions as unknown[])
		: [];
	return raw
		.filter((q): q is Record<string, unknown> => q !== null && typeof q === 'object')
		.map((q) => ({
			id: typeof q.id === 'string' ? q.id : '',
			question: typeof q.question === 'string' ? q.question : '',
			header: typeof q.header === 'string' ? q.header : undefined,
			detail: typeof q.detail === 'string' ? q.detail : undefined,
			options: Array.isArray(q.options)
				? (q.options as Array<Record<string, unknown>>).map((o) => ({
						label: typeof o.label === 'string' ? o.label : '',
						description: typeof o.description === 'string' ? o.description : undefined
					}))
				: undefined,
			multiSelect: q.multiSelect === true,
			intent:
				q.intent !== null && typeof q.intent === 'object'
					? {
							kind: typeof (q.intent as { kind?: unknown }).kind === 'string' ? (q.intent as { kind: string }).kind : '',
							approve:
								typeof (q.intent as { approve?: unknown }).approve === 'string'
									? (q.intent as { approve: string }).approve
									: undefined
						}
					: undefined
		}));
}

/**
 * Parse a tool-result's chosen answers (ask_user_question resultText)
 * into per-question selections.
 */
export function parseAnswers(resultText: string | undefined): QAnswer[] {
	if (resultText === undefined) return [];
	try {
		const parsed = JSON.parse(resultText) as { answers?: unknown };
		if (!Array.isArray(parsed?.answers)) return [];
		return parsed.answers
			.filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
			.map((a) => ({
				id: typeof a.id === 'string' ? a.id : '',
				selected: Array.isArray(a.selected)
					? a.selected.filter((s): s is string => typeof s === 'string')
					: [],
				custom: typeof a.custom === 'string' ? a.custom : undefined
			}));
	} catch {
		return [];
	}
}

/**
 * Human summary of a batch answer for a settled card's outcome line —
 * the chosen labels (and custom text) per question, " · "-joined,
 * truncated to one line; 'answered' when nothing parseable was chosen.
 */
export function answersOutcome(answers: QAnswer[]): string {
	if (answers.length === 0) return 'answered';
	const parts = answers.map((a) => {
		const chosen = [...a.selected, ...(a.custom ? [a.custom] : [])];
		return chosen.length > 0 ? chosen.join(', ') : 'answered';
	});
	const line = parts.join(' · ');
	return line.length > 80 ? line.slice(0, 79) + '…' : line;
}

/**
 * A request narrowed to the `plan-review` presentation intent: everything
 * the review card renders and answers with. `approve` and `decline` are the
 * asker's own options — an answer must carry one of those labels verbatim —
 * and `plan` is the markdown body under review.
 */
export interface PlanReview {
	/** The reviewed question's id, echoed in the answer. */
	id: string;
	/** The question text, kept as the card's accessible name. */
	question: string;
	/** The plan markdown under review. */
	plan: string;
	/** The option that approves the plan. */
	approve: QOption;
	/** The option that declines it; absent when the asker offered no other option. */
	decline?: QOption;
}

/**
 * Narrow a request to a renderable plan review, or return undefined to leave
 * it to the generic question flow.
 *
 * CONTRACT MIRROR — do not import, re-derive: DSI has no package dependency
 * on DSH, so this mirrors DSH `contract/slots.ts` `planReviewOf`
 * (packages/client/ui-user-questions/src/client/contract/slots.ts, read at
 * DSH 0.1.2-alpha.1, 2026-08-31). A DSH change to the native arms will not
 * fail this build — the per-arm unit tests are the drift alarm.
 *
 * The card is one decision over one plan, and it claims a request only when
 * it can send every answer that request allows — an intent changes the
 * layout, never which answers are reachable. The six native arms, in order
 * (first refusal wins): single question → intent.kind is `plan-review` →
 * detail carries the plan → not multiSelect → at most two options → the
 * approve label the intent names exists among them. Any refusal keeps the
 * request in the generic flow.
 */
export function planReviewOf(questions: QItem[]): PlanReview | undefined {
	if (questions.length !== 1) return undefined;
	const question = questions[0];
	const intent = question.intent;
	if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined;
	if (question.multiSelect === true) return undefined;
	const options = question.options ?? [];
	if (options.length > 2) return undefined;
	const approve = options.find((option) => option.label === intent.approve);
	if (approve === undefined) return undefined;
	const decline = options.find((option) => option.label !== intent.approve);
	return {
		id: question.id,
		question: question.question,
		plan: question.detail,
		approve,
		...(decline === undefined ? {} : { decline })
	};
}
