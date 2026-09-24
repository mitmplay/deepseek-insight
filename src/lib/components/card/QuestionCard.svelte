<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
import * as m from '$lib/paraglide/messages';
	/**
	 * QuestionCard — one pending ask() from the harness (POC-3 W2, task 2.2).
	 *
	 * One ask() is one batch of questions answered TOGETHER (core contract:
	 * one ask, many questions, one answer). Presentational — props only; the
	 * parent (store) owns the respond POST and the state machine, identical
	 * to ApprovalCard's (waiting → in-flight → settled / answered-elsewhere /
	 * withdrawn).
	 *
	 * Client-side validation MIRRORS the host rules (api-proxy matchesQuestions)
	 * so honest errors surface BEFORE the wire rejects:
	 *   — one answer per question, id echoed, selected option LABELS;
	 *   — no duplicate selections; custom, when present, must be non-blank;
	 *   — single-select: no custom+selected mix, at most one selected;
	 *   — every selected label must be a member of the question's options;
	 *   — the batch submits only when EVERY question validates.
	 * Mirrored rules are re-derived here on purpose (host owns the truth; the
	 * card owns the pre-flight honesty) — the wire stays the judge.
	 *
	 * XSS posture: question/detail/label/description render as TEXT nodes
	 * only. The ONE exception is a claimed plan review's plan body, which
	 * renders through MarkdownContent's escape-first allow-list pipeline
	 * (BC-12) — never raw {@html} of wire text.
	 */

	/** One question in the batch (AskUserQuestionItem, wire-verbatim subset). */
	import type { QItem, PlanReview } from '$lib/utils/questions';
	import { planReviewOf } from '$lib/utils/questions';
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
	export type { QItem };

	interface Props {
		rpcId: string;
		/** question/requested body.questions, verbatim. */
		questions: QItem[];
		phase: 'waiting' | 'in-flight' | 'settled' | 'answered-elsewhere' | 'withdrawn';
		/** Settlement outcome once settled: 'answered' | 'cancelled' | string. */
		outcome?: string;
		/** Chosen answers (ask result / settlement) — seeds the drafts so a
		 *  read-only card shows the chosen options checked (transcript
		 *  QuestionBlock parity, 2026-08-24). Ignored in waiting. */
		answers?: Array<{ id: string; selected: string[]; custom?: string }>;
		/** Fired with the full batch answer when valid (waiting only). */
		onanswer?: (answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> }) => void;
	}

	let { rpcId, questions, phase, outcome, answers, onanswer }: Props = $props();

	/** Claim the plan-review presentation, or undefined to keep the generic
	 *  flow (the six native arms, mirrored in planReviewOf — first refusal
	 *  wins, and the generic card stays byte-identical). */
	const review = $derived(planReviewOf(questions));

	/** Accessible name id for a claimed review — the question text names the
	 *  decision (PRD §2.1), so the review body can be labelled by it. */
	const reviewNameId = $derived(`plan-review-name-${rpcId}`);

	interface Draft {
		selected: string[];
		custom: string;
	}

	/** Local draft per question id — starts EMPTY in waiting (nothing
	 *  pre-selected, BC-D), or SEEDED from `answers` on read-only surfaces
	 *  (the transcript's answered block shows the chosen options checked).
	 * Intentional initial capture: the draft set is keyed by THIS card's
	 * question ids for its lifetime (one component per pending rpcId). */
	// svelte-ignore state_referenced_locally
	let drafts = $state<Record<string, Draft>>(
		Object.fromEntries(
			questions.map((q) => [
				q.id,
				{
					selected: phase === 'waiting' ? [] : (answers?.find((a) => a.id === q.id)?.selected ?? []),
					custom: phase === 'waiting' ? '' : (answers?.find((a) => a.id === q.id)?.custom ?? '')
				}
			])
		)
	);

	function toggle(q: QItem, label: string): void {
		if (phase !== 'waiting') return;
		const draft = drafts[q.id];
		if (!draft) return;
		if (q.multiSelect === true) {
			const at = draft.selected.indexOf(label);
			if (at === -1) draft.selected.push(label);
			else draft.selected.splice(at, 1);
		} else {
			// Single-select: clicking the selected option clears it; else it replaces.
			draft.selected = draft.selected[0] === label ? [] : [label];
		}
	}

	/** Host rule mirror — the exact matchesQuestions verdict per question. */
	function invalidReason(q: QItem): string | undefined {
		const draft = drafts[q.id];
		if (!draft) return 'no draft';
		if (draft.selected.some((l, i) => draft.selected.indexOf(l) !== i)) return 'duplicate selection';
		const members = new Set((q.options ?? []).map((o) => o.label));
		if (draft.selected.some((l) => !members.has(l))) return 'unknown option selected';
		const custom = draft.custom.trim();
		if (custom !== '' && q.multiSelect !== true && draft.selected.length > 0)
			return 'choose either an option or your own answer';
		if (q.multiSelect !== true && draft.selected.length > 1) return 'pick at most one option';
		if (draft.custom.trim() !== '' && custom === '') return 'custom answer is blank';
		return undefined;
	}

	/** Blank (unanswered) questions are honest incomplete, not invalid. */
	function isBlank(q: QItem): boolean {
		const d = drafts[q.id];
		return !!d && d.selected.length === 0 && d.custom.trim() === '';
	}

	const anyInvalid = $derived(questions.some((q) => invalidReason(q) !== undefined));
	const anyBlank = $derived(questions.some((q) => isBlank(q)));
	const canSubmit = $derived(phase === 'waiting' && !anyInvalid && !anyBlank);

	function submit(): void {
		if (!canSubmit || !onanswer) return;
		onanswer({
			answers: questions.map((q) => {
				const d = drafts[q.id];
				const custom = d.custom.trim();
				return {
					id: q.id,
					selected: [...d.selected],
					...(custom !== '' ? { custom } : {})
				};
			})
		});
	}

	/** Submit a review decision — the SAME batch envelope as the generic flow,
	 *  one question carrying the asker's own label verbatim, and no `custom`
	 *  key (approve ⟺ selected=[approveLabel] ∧ no custom, host rule). */
	function answerReview(claimed: PlanReview, label: string): void {
		if (phase !== 'waiting' || !onanswer) return;
		onanswer({ answers: [{ id: claimed.id, selected: [label] }] });
	}
</script>

<div
	class="max-w-[85%] self-start rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200"
	data-testid="question-card"
	data-rpc-id={rpcId}
	data-phase={phase}
	role={review ? 'region' : undefined}
	aria-labelledby={review ? reviewNameId : undefined}
>
	<div class="flex items-center gap-2">
		<span
			aria-hidden="true"
			class="inline-block h-2 w-2 shrink-0 rounded-full {phase === 'withdrawn'
				? 'bg-slate-400'
				: phase === 'settled' || phase === 'answered-elsewhere'
					? 'bg-emerald-500'
					: 'bg-amber-500'}"
		></span>
		<span class="font-medium" data-testid="question-card-title">
			{questions.length === 1 ? t(m.question) : `${questions.length} ${t(m.questions)}`}
		</span>
	</div>

	{#if review}
		<!-- Review shape (claimed request, 2026-08-31): the plan reads as a
		     document through MarkdownContent (BC-12 escape-first), the two
		     decision buttons carry the asker's own option labels, and the
		     batch answer is the SAME envelope — no tick boxes, no custom
		     line, nothing else reachable. Terminal phases drop the buttons
		     and keep the plan plus the shared decision line below. -->
		<div class="mt-2" data-testid="plan-review-body">
			{#if questions[0]?.header}
				<p class="text-xs uppercase tracking-wide text-slate-400" data-testid="plan-review-eyebrow">{questions[0].header}</p>
			{/if}
			<h3 id={reviewNameId} class="font-medium whitespace-pre-wrap break-words" data-testid="plan-review-question">{review.question}</h3>
			<div class="mt-2 rounded-lg ring-1 ring-slate-100 p-2">
				<MarkdownContent content={review.plan} hideToggle />
			</div>
		</div>
		{#if phase === 'waiting' || phase === 'in-flight'}
			<div class="mt-3 flex items-center gap-2">
				<button
					type="button"
					data-testid="plan-review-approve"
					title={review.approve.description}
					disabled={phase !== 'waiting'}
					onclick={() => answerReview(review, review.approve.label)}
					class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{review.approve.label}
				</button>
				{#if review.decline}
					{@const declineOption = review.decline}
					<button
						type="button"
						data-testid="plan-review-decline"
						title={declineOption.description}
						disabled={phase !== 'waiting'}
						onclick={() => answerReview(review, declineOption.label)}
						class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{declineOption.label}
					</button>
				{/if}
				{#if phase === 'in-flight'}
					<span class="text-xs text-slate-400">{t(m.sending)}</span>
				{/if}
			</div>
		{/if}
	{:else}
	{#if questions.length > 0}
		<!-- Questions render in EVERY phase (honest-data fix 2026-08-24):
		     a settled/withdrawn card keeps showing WHAT was asked — read-only
		     (buttons disabled outside waiting, no custom input, no submit).
		     The picked answer stays visible in the transcript tool chip. -->
		<div class="mt-2 flex flex-col gap-3" data-testid="question-questions">
			{#each questions as q (q.id)}
				<div class="rounded-lg ring-1 ring-slate-100 p-2 {phase === 'waiting' || phase === 'in-flight' ? '' : 'opacity-80'}" data-testid="question-item" data-question-id={q.id}>
					<p class="font-medium whitespace-pre-wrap break-words" data-testid="question-text">{q.question}</p>
					{#if q.header}
						<p class="mt-0.5 text-xs text-slate-400" data-testid="question-header">{q.header}</p>
					{/if}
					{#if q.detail}
						<p class="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-500" data-testid="question-detail">{q.detail}</p>
					{/if}
					{#if q.options && q.options.length > 0}
						<div class="mt-1.5 flex flex-col gap-1" data-testid="question-options">
							{#each q.options as opt (opt.label)}
								<button
									type="button"
									data-testid="question-option"
									data-label={opt.label}
									data-checked={drafts[q.id]?.selected.includes(opt.label)}
									disabled={phase !== 'waiting'}
									onclick={() => toggle(q, opt.label)}
									class="flex items-start gap-2 rounded-md border px-2 py-1 text-left text-xs
									{drafts[q.id]?.selected.includes(opt.label)
										? 'border-emerald-300 bg-emerald-50 text-emerald-800'
										: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}
									disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span
										aria-hidden="true"
										class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border
										{q.multiSelect === true ? 'rounded-[2px]' : 'rounded-full'}
										{drafts[q.id]?.selected.includes(opt.label)
											? 'border-emerald-600 bg-emerald-600 text-white'
											: 'border-slate-300 bg-white'}"
									>{drafts[q.id]?.selected.includes(opt.label) ? '✓' : ''}</span>
									<span>
										<span class="block">{opt.label}</span>
										{#if opt.description}
											<span class="block text-[11px] text-slate-400">{opt.description}</span>
										{/if}
									</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if phase === 'waiting' || phase === 'in-flight'}
						<input
							type="text"
							data-testid="question-custom"
							data-question-id={q.id}
							placeholder="Your own answer (optional)"
							disabled={phase === 'in-flight'}
							bind:value={drafts[q.id].custom}
							class="mt-1.5 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
						/>
					{/if}
					{#if phase === 'waiting' && invalidReason(q)}
						<p class="mt-1 text-[11px] text-red-600" data-testid="question-invalid">{invalidReason(q)}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if phase === 'waiting' || phase === 'in-flight'}
		<div class="mt-3 flex items-center gap-2">
			<button
				type="button"
				data-testid="question-submit"
				disabled={!canSubmit}
				onclick={submit}
				class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{phase === 'in-flight' ? t(m.sending) : t(m.answer)}
			</button>
			<span class="text-xs text-slate-400" data-testid="question-submit-hint">
				{#if phase === 'in-flight'}answering…{:else if anyInvalid}{t(m.fixMarkedAnswers)}{:else if anyBlank}{t(m.everyQuestionNeedsAnswer)}{/if}
			</span>
		</div>
	{/if}
	{/if}

	{#if phase === 'settled'}
		<p class="mt-2 text-xs text-emerald-700" data-testid="question-settled">{t(m.answered)} {outcome ?? 'sent'}.</p>
	{:else if phase === 'answered-elsewhere'}
		<p class="mt-2 text-xs text-slate-500" data-testid="question-elsewhere">
			{t(m.answeredElsewhere)}
		</p>
	{:else if phase === 'withdrawn'}
		<p class="mt-2 text-xs text-slate-500" data-testid="question-withdrawn">
			{t(m.requestWithdrawn)}
		</p>
	{/if}
</div>
