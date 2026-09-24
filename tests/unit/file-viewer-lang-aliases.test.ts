/**
 * FileContentViewer — the 'markdown' lang alias (file-content-viewer.test.ts
 * pins 'md' and the .mdx path): the middle arm of the markdown-family
 * check also renders prose for lang 'markdown'.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FileContentViewer from '$lib/components/common/viewers/FileContentViewer.svelte';
import type { DsiReadLine, DsiReadView } from '$lib/types';

function line(number: number, text = `line ${number}`): DsiReadLine {
	return { number, text };
}

function mountView(v: DsiReadView) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(FileContentViewer, { target, props: { view: v } });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('FileContentViewer — markdown lang alias', () => {
	it("lang 'markdown' renders prose, not code", () => {
		const { target, instance } = mountView({
			path: 'notes.md',
			lang: 'markdown',
			offset: 1,
			totalLines: 1,
			lines: [line(1, '# Title')]
		});
		expect(target.querySelector('[data-testid="file-viewer-markdown"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="file-viewer-code"]')).toBeNull();
		expect(target.querySelector('[data-testid="file-viewer-plain"]')).toBeNull();
		unmount(instance);
	});
});
