/**
 * AboutDialog unit tests — the sidebar footer's about box.
 *
 * Component-direct mount (tray-buttons.test.ts pattern): the dialog is
 * a shell — fixed backdrop + centered frame with static copy — so the
 * suite pins the four content surfaces (h1, h2, credit, link) and the
 * three dismiss gestures (backdrop click, × click, Escape), each
 * firing onclose exactly once. The BC-7 portal (mount-to-body) is the
 * HOST's job — covered by the sessions-list footer test.
 */

import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutDialog from '$lib/components/sessions/AboutDialog.svelte';

function renderAbout(onclose: () => void): { unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(AboutDialog, { target, props: { onclose } });
	return { unmount: () => unmount(comp) };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AboutDialog — the about box shell', () => {
	it('renders the title, subtitle, credit, and the author link', () => {
		const onclose = vi.fn();
		const { unmount: off } = renderAbout(onclose);
		expect(document.querySelector('[data-testid="about-title"]')?.textContent).toBe(
			'DEEPSEEK INSIGHT'
		);
		expect(document.querySelector('[data-testid="about-subtitle"]')?.textContent).toBe(
			'Getting Insight of Deepseek Harness'
		);
		expect(document.querySelector('[data-testid="about-credit"]')?.textContent?.trim()).toBe(
			'Created by: Widi Harsojo (c) 2026 - Apache License'
		);
		const link = document.querySelector('[data-testid="about-link"]') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('https://www.linkedin.com/in/wharsojo/');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		off();
	});

	it('a backdrop click fires onclose', () => {
		const onclose = vi.fn();
		const { unmount: off } = renderAbout(onclose);
		(document.querySelector('.about-backdrop') as HTMLElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true })
		);
		expect(onclose).toHaveBeenCalledTimes(1);
		off();
	});

	it('the × close fires onclose', () => {
		const onclose = vi.fn();
		const { unmount: off } = renderAbout(onclose);
		(document.querySelector('[data-testid="about-close"]') as HTMLButtonElement).click();
		expect(onclose).toHaveBeenCalledTimes(1);
		off();
	});

	it('Escape fires onclose; a non-Escape key never does', () => {
		const onclose = vi.fn();
		const { unmount: off } = renderAbout(onclose);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(onclose).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(onclose).toHaveBeenCalledTimes(1);
		off();
	});
});
