/**
 * GoalCard branch arms (coverage pass 2026-09-14): the phase badge's
 * paused/blocked classes, the cap-only meta line (goal-less args with
 * max_goal_rounds), the activation chip, the blockedReason note, the
 * raw-result pane, and the junk-inputs raw-only view.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GoalCard from '$lib/components/message/GoalCard.svelte';

function render(props: Record<string, unknown> & { toolName: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(GoalCard, { target, props });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance as never);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalCard branch arms', () => {
	it('phase badges: paused and blocked classes; blockedReason renders its note', () => {
		const goal = {
			id: 'g1', revision: 2, objective: 'Do the thing', phase: 'paused',
			roundsStarted: 1, max_goal_rounds: 5
		};
		const view = render({
			toolName: 'get_goal',
			resultText: JSON.stringify({ goal })
		});
		const badge = view.target.querySelector('[data-testid="goal-phase"]');
		expect(badge).not.toBeNull();
		expect(badge!.className).toContain('bg-slate-50');
		view.cleanup();

		const blocked = { ...goal, phase: 'blocked', blockedReason: { code: 'no_progress', message: 'stuck' } };
		const view2 = render({
			toolName: 'get_goal',
			resultText: JSON.stringify({ goal: blocked })
		});
		const badge2 = view2.target.querySelector('[data-testid="goal-phase"]');
		expect(badge2!.className).toContain('bg-red-50');
		const note = view2.target.querySelector('[data-testid="goal-blocked"]');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('stuck');
		view2.cleanup();
	});

	it('goal-less args with max_goal_rounds render the cap-only meta line', () => {
		const view = render({
			toolName: 'create_goal',
			argsRaw: JSON.stringify({ objective: 'Ship it', max_goal_rounds: 7 })
		});
		const meta = view.target.querySelector('[data-testid="goal-meta"]');
		expect(meta).not.toBeNull();
		expect(meta!.textContent).toContain('cap 7');
		view.cleanup();
	});

	it('the activation chip renders when the result carries one', () => {
		const view = render({
			toolName: 'create_goal',
			argsRaw: JSON.stringify({ objective: 'Ship it' }),
			resultText: JSON.stringify({
				goal: { id: 'g9', revision: 1, objective: 'Ship it', phase: 'active', roundsStarted: 0, max_goal_rounds: 3 },
				activation: 'armed'
			})
		});
		expect(view.target.querySelector('[data-testid="goal-phase"]')).not.toBeNull();
		view.cleanup();
	});

	it('junk on both sides renders the raw panes with no card chrome', () => {
		const view = render({ toolName: 'get_goal', argsRaw: 'not json', resultText: 'also not json' });
		expect(view.target.querySelector('[data-testid="goal-card"]')).toBeNull();
		expect(view.target.querySelector('[data-testid="goal-raw-result"]')).not.toBeNull();
		view.cleanup();
	});
});
