/**
 * Locale settings row — Three Tongues W2 task 2.3-T.
 * The row reads the dsi document through /api/settings, a change PUTs the
 * WHOLE buffer with ui.locale set (document is the authority, Settings
 * Panel ADR D5), and the immediate flip rides the locale-state service
 * (asserted via the dsi.locale cookie). fetch is mocked at the seam.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocaleSettingsRow from '$lib/components/language-menu/LocaleSettingsRow.svelte';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(LocaleSettingsRow, { target });
	return { target, instance };
}

function cleanup(instance: unknown, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}

afterEach(() => {
	document.body.innerHTML = '';
	fetchMock.mockReset();
});

beforeEach(() => {
	localStorage.removeItem('dsi.locale');
	document.cookie = 'dsi.locale=; path=/; max-age=0';
	fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
		if (init?.method === 'PUT') {
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}
		return new Response(JSON.stringify({ ok: true, text: 'chat:\n  input:\n    maxRows: 15\n', missing: false }), { status: 200 });
	});
});

describe('LocaleSettingsRow (2.3)', () => {
	it('renders the fleet options with catalog names', () => {
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		const values = Array.from(select.options).map((o) => o.value);
		expect(values).toEqual(['en', 'zh', 'id', 'es']);
		expect(select.options[2].textContent).toContain('Bahasa Indonesia');
		expect(select.options[3].textContent).toContain('Español');
		cleanup(h.instance, h.target);
	});

	it('a change PUTs the whole document with ui.locale set (D5 seam)', async () => {
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'zh';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
		expect(put).toBeDefined();
		const body = JSON.parse(put![1].body) as { text: string };
		expect(body.text).toContain('locale: zh');
		expect(body.text).toContain('maxRows: 15'); // unrelated keys survive
		// immediate flip rides the service
		expect(document.cookie).toContain('dsi.locale=zh');
		cleanup(h.instance, h.target);
	});

	it('a failed PUT surfaces the error and leaves the service untouched', async () => {
		fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
			if (init?.method === 'PUT') return new Response(null, { status: 400 });
			return new Response(JSON.stringify({ ok: true, text: 'a: 1\n', missing: false }), { status: 200 });
		});
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'id';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		expect(h.target.querySelector('[data-testid="locale-error"]')).not.toBeNull();
		expect(document.cookie).not.toContain('dsi.locale=id');
		cleanup(h.instance, h.target);
	});


	it('an out-of-fleet value short-circuits before any fetch (early return arm)', async () => {
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'xx';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(h.target.querySelector('[data-testid="locale-error"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('a failed READ surfaces the error without attempting a PUT', async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'zh';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		expect(h.target.querySelector('[data-testid="locale-error"]')).not.toBeNull();
		expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
		cleanup(h.instance, h.target);
	});

	it('a missing document PUTs a fresh doc carrying only ui.locale (missing arm)', async () => {
		fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
			return new Response(JSON.stringify({ ok: true, missing: true }), { status: 200 });
		});
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'id';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
		expect(put).toBeDefined();
		const body = JSON.parse(put![1].body) as { text: string };
		expect(body.text).toContain('locale: id');
		expect(body.text).not.toContain('maxRows');
		cleanup(h.instance, h.target);
	});

	it('a non-object ui node is replaced rather than mutated', async () => {
		fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
			return new Response(JSON.stringify({ ok: true, text: 'ui: 5\n', missing: false }), { status: 200 });
		});
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		select.value = 'en';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 30));
		const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
		expect(put).toBeDefined();
		expect((JSON.parse(put![1].body) as { text: string }).text).toContain('locale: en');
		cleanup(h.instance, h.target);
	});

	it('shows the saving indicator while a save is in flight and marks selected option', async () => {
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === 'PUT') await gate;
			return new Response(JSON.stringify({ ok: true, text: 'a: 1\n', missing: false }), { status: 200 });
		});
		const h = render();
		const select = h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement;
		expect(select.options[0].selected).toBe(true); // default en is selected
		select.value = 'zh';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 10));
		expect(h.target.querySelector('[data-testid="locale-saving"]')).not.toBeNull();
		expect((h.target.querySelector('[data-testid="locale-select"]') as HTMLSelectElement).disabled).toBe(true);
		release();
		await new Promise((r) => setTimeout(r, 30));
		expect(h.target.querySelector('[data-testid="locale-saving"]')).toBeNull();
		cleanup(h.instance, h.target);
	});
});
