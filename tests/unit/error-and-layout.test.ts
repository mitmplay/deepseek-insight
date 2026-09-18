/**
 * Route-shell tests: the root layout renders its children (the one
 * place global styles enter), and the app-wide error boundary speaks
 * all three statuses — 404 (session absent), 503 (host down), and the
 * unexpected fallback (including the no-error-message default). The
 * page stub is the shared mutable $state — tests point it at scenarios.
 */
import { createRawSnippet, flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ErrorPage from '../../src/routes/+error.svelte';
import Layout from '../../src/routes/+layout.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';

afterEach(() => {
	reactiveTestPage.status = 200;
	reactiveTestPage.error = null;
	document.body.innerHTML = '';
});

describe('+layout — the style root', () => {
	it('renders its children', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const children = createRawSnippet(() => ({
			render: () => '<p data-testid="layout-child">app content</p>'
		}));
		const instance = mount(Layout, { target, props: { children } });
		flushSync();
		expect(target.querySelector('[data-testid="layout-child"]')?.textContent).toBe('app content');
		unmount(instance);
	});
});

describe('+error — the error boundary', () => {
	function mountError(): { target: HTMLElement; instance: ReturnType<typeof mount> } {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ErrorPage, { target });
		flushSync();
		return { target, instance };
	}

	it('404: session not found, with the wire message', () => {
		reactiveTestPage.status = 404;
		reactiveTestPage.error = { message: 'No such session in the ledger' } as App.Error;
		const { target, instance } = mountError();
		expect(target.querySelector('[data-testid="error-status"]')?.textContent).toBe('404');
		expect(target.textContent).toContain('Session not found');
		expect(target.querySelector('[data-testid="error-message"]')?.textContent).toBe(
			'No such session in the ledger'
		);
		expect(target.querySelector('[data-testid="error-back-home"]')).not.toBeNull();
		unmount(instance);
	});

	it('503: DSH host unreachable', () => {
		reactiveTestPage.status = 503;
		reactiveTestPage.error = { message: 'connection refused' } as App.Error;
		const { target, instance } = mountError();
		expect(target.textContent).toContain('DSH host unreachable');
		expect(target.querySelector('[data-testid="error-message"]')?.textContent).toBe(
			'connection refused'
		);
		unmount(instance);
	});

	it('any other status: the unexpected fallback, with a default when the wire gives no message', () => {
		reactiveTestPage.status = 500;
		reactiveTestPage.error = null;
		const { target, instance } = mountError();
		expect(target.textContent).toContain('Unexpected error');
		expect(target.querySelector('[data-testid="error-message"]')?.textContent).toBe(
			'Something went wrong.'
		);
		unmount(instance);
	});
});
