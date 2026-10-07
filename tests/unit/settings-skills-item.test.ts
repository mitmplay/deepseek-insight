/**
 * SettingsSkillsItem tests — one shelf skill card, presentational:
 * it renders the id/n pair, the optional tier pill and installed/foreign
 * badge, the uninstall verb only when uninstallable (busy disabled), the
 * dup marker on the id, the overview paragraph or the muted fallback,
 * the checked class, and reports check/uninstall intents upward.
 */
import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsItem from '../../src/lib/components/settings-skills/SettingsSkillsItem.svelte';

const BASE = {
	id: 'my-skill',
	n: '1.2',
	tier: null as string | null,
	checked: false,
	uninstallable: false,
	busy: false,
	badge: null as string | null,
	overview: null as string | null
};

function mountItem(props: Partial<typeof BASE> & Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontoggle = vi.fn();
	const onuninstall = vi.fn();
	const instance = mount(SettingsSkillsItem, { target, props: { ...BASE, ontoggle, onuninstall, ...props } });
	flushSync();
	return { target, ontoggle, onuninstall };
}

function q(target: HTMLElement, sel: string): Element | null {
	return target.querySelector(sel);
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SettingsSkillsItem', () => {
	it('renders the row keyed by id with the n and id text', () => {
		const { target } = mountItem();
		expect(q(target, '[data-testid="shelf-row-my-skill"]')).not.toBeNull();
		expect(q(target, '.shelf-n')!.textContent).toBe('1.2');
		expect(q(target, '.shelf-id')!.textContent).toBe('my-skill');
	});

	it('marks the id with (d) when dup is true', () => {
		const { target } = mountItem({ dup: true });
		expect(q(target, '.shelf-id')!.textContent).toBe('my-skill(d)');
	});

	it('shows a bare id when dup is explicitly false', () => {
		const { target } = mountItem({ dup: false });
		expect(q(target, '.shelf-id')!.textContent).toBe('my-skill');
	});

	it('shows a bare id when dup is left undefined (default arm)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const { dup, ...rest } = BASE;
		void dup;
		mount(SettingsSkillsItem, { target, props: { ...rest } });
		flushSync();
		expect(q(target, '.shelf-id')!.textContent).toBe('my-skill');
	});

	it('renders without crashing when id is omitted (nullish fallback arm of the id slot)', () => {
		const { ontoggle, onuninstall, ...rest } = BASE;
		void ontoggle;
		void onuninstall;
		const target = document.createElement('div');
		document.body.appendChild(target);
		const props: Record<string, unknown> = { ...rest };
		delete props.id;
		mount(SettingsSkillsItem, { target, props });
		flushSync();
		expect(q(target, '.shelf-id')!.textContent).toBe('');
	});

	it('renders the checked class when checked', () => {
		const { target } = mountItem({ checked: true });
		expect(q(target, 'li.shelf-card')!.classList.contains('checked')).toBe(true);
	});

	it('omits the checked class when unchecked', () => {
		const { target } = mountItem({ checked: false });
		expect(q(target, 'li.shelf-card')!.classList.contains('checked')).toBe(false);
	});

	it('shows the tier pill only when a tier is given', () => {
		const withTier = mountItem({ tier: 'gold' });
		expect(q(withTier.target, '[data-testid="shelf-tier"]')!.textContent).toBe('gold');
		const noTier = mountItem({ tier: null });
		expect(q(noTier.target, '[data-testid="shelf-tier"]')).toBeNull();
	});

	it('shows the badge only when badge text is given', () => {
		const withBadge = mountItem({ badge: 'installed' });
		expect(q(withBadge.target, '[data-testid="shelf-badge"]')!.textContent).toBe('installed');
		const noBadge = mountItem({ badge: null });
		expect(q(noBadge.target, '[data-testid="shelf-badge"]')).toBeNull();
	});

	it('renders the uninstall verb only when uninstallable, and it fires the intent', () => {
		const yes = mountItem({ uninstallable: true });
		const verb = q(yes.target, '[data-testid="shelf-uninstall-my-skill"]') as HTMLButtonElement | null;
		expect(verb).not.toBeNull();
		expect(verb!.disabled).toBe(false);
		verb!.click();
		flushSync();
		expect(yes.onuninstall).toHaveBeenCalledTimes(1);
		const no = mountItem({ uninstallable: false });
		expect(q(no.target, '[data-testid^="shelf-uninstall"]')).toBeNull();
	});

	it('disables the uninstall verb while busy', () => {
		const { target } = mountItem({ uninstallable: true, busy: true });
		const verb = q(target, '[data-testid="shelf-uninstall-my-skill"]') as HTMLButtonElement;
		expect(verb.disabled).toBe(true);
		verb.click();
		flushSync();
	});

	it('shows the overview paragraph when an overview exists', () => {
		const { target } = mountItem({ overview: 'Does a thing.' });
		expect(q(target, '[data-testid="shelf-overview"]')!.textContent).toBe('Does a thing.');
		expect(q(target, '[data-testid="shelf-overview-empty"]')).toBeNull();
	});

	it('falls back to the muted no-overview line when the overview is null', () => {
		const { target } = mountItem({ overview: null });
		expect(q(target, '[data-testid="shelf-overview-empty"]')).not.toBeNull();
		expect(q(target, '[data-testid="shelf-overview-empty"]')!.textContent!.length).toBeGreaterThan(0);
		expect(q(target, '[data-testid="shelf-overview"]')).toBeNull();
	});

	it('reports a check intent carrying the row key n', () => {
		const { target, ontoggle } = mountItem();
		const box = q(target, 'input[type="checkbox"]') as HTMLInputElement;
		box.click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledWith('1.2');
	});

	it('checkbox reflects the checked prop', () => {
		const { target } = mountItem({ checked: true });
		const box = q(target, 'input[type="checkbox"]') as HTMLInputElement;
		expect(box.checked).toBe(true);
	});

	it('survives a toggle with no ontoggle handler wired', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SettingsSkillsItem, { target, props: { ...BASE } });
		flushSync();
		(q(target, 'input[type="checkbox"]') as HTMLInputElement).click();
		flushSync();
		// uninstallable false: no verb to click; nothing throws
		expect(q(target, '[data-testid="shelf-row-my-skill"]')).not.toBeNull();
	});
});