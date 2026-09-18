/**
 * Goal-tool payload parsing — the ONE parser shared by every surface
 * that renders the goal tool family's payloads (GoalCard in the chip
 * popup; any future surface). Wire shapes pinned 2026-08-26 from DSH
 * packages/goal/tool-goal (source of truth): tool names get_goal /
 * create_goal / update_goal; args keys are snake_case; every result is
 * the compact goal value {goal|null, activation}. Malformed input
 * parses to undefined — the caller keeps the raw view, never throws.
 */

/** update_goal action verbs (wire enum, tool-goal UPDATE_ACTIONS). */
export type GoalAction = 'edit' | 'pause' | 'resume' | 'complete' | 'blocked';

/** Goal args subset the card renders (wire-verbatim snake_case keys). */
export interface GoalArgFields {
	objective?: string;
	max_goal_rounds?: number;
	goal_id?: string;
	revision?: number;
	action?: GoalAction;
	blocked_reason?: string;
}

/** Durable goal phase (wire enum, GoalPhase). */
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete';

/** blockedReason member (GoalBlockReason, wire-verbatim subset). */
export interface GoalBlockReason {
	code: string;
	message: string;
}

/** The result's goal member, wire-verbatim subset. */
export interface GoalResultGoal {
	id: string;
	revision: number;
	objective: string;
	phase: GoalPhase;
	roundsStarted: number;
	maxGoalRounds: number;
	blockedReason?: GoalBlockReason;
}

/** Every goal tool's result: the compact goal value. */
export interface GoalResult {
	goal: GoalResultGoal | null;
	activation?: 'armed' | 'disarmed';
}

/**
 * Chip titles carry the raw wire tool name; the goal family is the
 * `_goal` suffix (get_goal / create_goal / update_goal today).
 */
export function isGoalTool(toolName: string): boolean {
	return toolName.endsWith('_goal');
}

const ACTIONS: ReadonlySet<string> = new Set(['edit', 'pause', 'resume', 'complete', 'blocked']);
const PHASES: ReadonlySet<string> = new Set(['active', 'paused', 'blocked', 'complete']);

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Parse goal args; undefined when junk or no known key survives. */
export function parseGoalArgs(argsRaw: string | undefined): GoalArgFields | undefined {
	if (argsRaw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
	const o = parsed as Record<string, unknown>;
	const objective = asString(o.objective);
	const goalId = asString(o.goal_id);
	const action = asString(o.action);
	const blockedReason = asString(o.blocked_reason);
	const out: GoalArgFields = {
		...(objective !== undefined ? { objective } : {}),
		...(typeof o.max_goal_rounds === 'number' ? { max_goal_rounds: o.max_goal_rounds } : {}),
		...(goalId !== undefined ? { goal_id: goalId } : {}),
		...(typeof o.revision === 'number' ? { revision: o.revision } : {}),
		...(action !== undefined && ACTIONS.has(action) ? { action: action as GoalAction } : {}),
		...(blockedReason !== undefined ? { blocked_reason: blockedReason } : {})
	};
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse a goal tool result; undefined when the text is not the goal
 * value shape. `{"goal":null}` PARSES — no current goal is a real
 * state, not junk.
 */
export function parseGoalResult(resultText: string | undefined): GoalResult | undefined {
	if (resultText === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(resultText);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
	const o = parsed as Record<string, unknown>;
	if (!('goal' in o)) return undefined;
	if (o.goal === null) return { goal: null };
	if (o.goal === null || typeof o.goal !== 'object' || Array.isArray(o.goal)) return undefined;
	const g = o.goal as Record<string, unknown>;
	const id = asString(g.id);
	const objective = asString(g.objective);
	const phase = asString(g.phase);
	if (id === undefined || objective === undefined || phase === undefined || !PHASES.has(phase)) {
		return undefined;
	}
	const reason = g.blockedReason;
	const reasonCode = reason !== null && typeof reason === 'object' ? asString((reason as Record<string, unknown>).code) : undefined;
	const reasonMessage = reason !== null && typeof reason === 'object' ? asString((reason as Record<string, unknown>).message) : undefined;
	const activation = asString(o.activation);
	return {
		goal: {
			id,
			revision: typeof g.revision === 'number' ? g.revision : 0,
			objective,
			phase: phase as GoalPhase,
			roundsStarted: typeof g.roundsStarted === 'number' ? g.roundsStarted : 0,
			maxGoalRounds: typeof g.maxGoalRounds === 'number' ? g.maxGoalRounds : 0,
			...(reasonCode !== undefined && reasonMessage !== undefined
				? { blockedReason: { code: reasonCode, message: reasonMessage } }
				: {})
		},
		...(activation === 'armed' || activation === 'disarmed' ? { activation } : {})
	};
}


/**
 * Parse a goals/* RemoteResult value (the host's GoalView — flat member
 * fields, unlike the tool-result compact value) into the GoalBar's read
 * shape. Undefined when the value is not a readable goal view — the caller
 * then waits for the next projection delta instead of applying a guess.
 */
export function parseGoalView(value: unknown): GoalResultGoal | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== 'string' || v.id.length === 0) return undefined;
	if (typeof v.objective !== 'string' || v.objective.length === 0) return undefined;
	if (typeof v.phase !== 'string' || !PHASES.has(v.phase)) return undefined;
	const reason = v.blockedReason;
	const reasonOk =
		reason === undefined ||
		(reason !== null &&
			typeof reason === 'object' &&
			typeof (reason as Record<string, unknown>).code === 'string' &&
			typeof (reason as Record<string, unknown>).message === 'string');
	if (!reasonOk) return undefined;
	return {
		id: v.id,
		revision: typeof v.revision === 'number' ? v.revision : 0,
		objective: v.objective,
		phase: v.phase as GoalPhase,
		roundsStarted: typeof v.roundsStarted === 'number' ? v.roundsStarted : 0,
		maxGoalRounds: typeof v.maxGoalRounds === 'number' ? v.maxGoalRounds : 0,
		...(reason !== undefined
			? {
					blockedReason: {
						code: (reason as Record<string, unknown>).code as string,
						message: (reason as Record<string, unknown>).message as string
					}
				}
			: {})
	};
}

/**
 * Card title verb for one goal tool call; undefined renders the bare
 * "Goal" (get_goal, or an unknown family member).
 */
export function goalVerb(toolName: string, action?: GoalAction): string | undefined {
	if (toolName === 'create_goal') return 'created';
	if (toolName === 'update_goal') {
		if (action === 'edit') return 'edited';
		if (action === 'pause') return 'paused';
		if (action === 'resume') return 'resumed';
		if (action === 'complete') return 'completed';
		if (action === 'blocked') return 'blocked';
		return 'updated';
	}
	return undefined;
}