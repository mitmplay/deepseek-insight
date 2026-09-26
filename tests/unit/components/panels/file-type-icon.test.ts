/**
 * FileTypeIcon render contract — every category branch of the shared 28px
 * glyph, the per-language code square delegation, and the size/transform
 * props. Colors are CSS class selections (class="fti <type>"), artwork is
 * fixed path data; the honest assertions are the branch-distinctive ones:
 * which mark renders, which transform it carries, and which branch the
 * codeType gate takes.
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import FileTypeIcon from '$lib/components/panels/FileTypeIcon.svelte';

function mountIcon(name: string, size?: number) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props: { name: string; size?: number } = { name };
	if (size !== undefined) props.size = size;
	const comp = mount(FileTypeIcon, { target, props });
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

/** Cases where the shared file glyph draws — {class} on the root svg. */
const GLYPH_CASES: Array<[name: string, type: string, large: boolean]> = [
	['sheet.xlsx', 'excel', true],
	['doc.docx', 'word', true],
	['report.pdf', 'pdf', true],
	['deck.pptx', 'ppt', true],
	['readme.md', 'markdown', true],
	['notes.txt', 'other', false],
	['photo.png', 'image', false],
	['clip.mp4', 'video', false],
	['page.html', 'html', false]
];

describe('FileTypeIcon', () => {
	it.each(GLYPH_CASES)('renders the shared glyph for %s as %s', (name, type, large) => {
		const h = mountIcon(name);
		const svg = h.target.querySelector('svg.fti');
		expect(svg).not.toBeNull();
		expect(svg?.classList.contains(type)).toBe(true);
		// Body + fold always present; fold uses the paper fill hook.
		expect(svg?.querySelector('path.fold')).not.toBeNull();
		// Exactly one category mark — none for 'other' — with the
		// branch-distinctive transform.
		const mark = svg?.querySelector('g.mark');
		if (type === 'other') {
			expect(mark).toBeNull();
		} else {
			expect(mark).not.toBeNull();
			expect(mark?.getAttribute('transform')).toBe(
				large
					? 'translate(14 16) scale(1.22) translate(-14 -16)'
					: 'translate(14 16) scale(1.12) translate(-14 -16)'
			);
		}
		h.cleanup();
	});

	it.each(GLYPH_CASES.filter(([n]) => n !== 'notes.txt').map(([n, t]) => [n, t] as const))(
		'draws a distinct mark path for %s (%s)',
		(name, type) => {
			const h = mountIcon(name);
			const d = h.target.querySelector('g.mark path')?.getAttribute('d');
			expect(d, type).toBeTruthy();
			h.cleanup();
		}
	);

	it('unknown category renders the bare glyph: no mark at all', () => {
		const h = mountIcon('archive.zip');
		expect(h.target.querySelector('svg.fti')?.classList.contains('other')).toBe(true);
		expect(h.target.querySelector('g.mark')).toBeNull();
		h.cleanup();
	});

	it('code extension delegates to the per-language CodeFileIcon, not the shared glyph', () => {
		const h = mountIcon('main.py');
		expect(h.target.querySelector('svg.fti')).toBeNull();
		const svg = h.target.querySelector('svg');
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
		// Non-empty per-language artwork (python square) rendered via {@html}.
		expect(svg?.innerHTML.length).toBeGreaterThan(0);
		h.cleanup();
	});

	it('exact code filenames resolve through the code branch too', () => {
		const h = mountIcon('package.json');
		expect(h.target.querySelector('svg.fti')).toBeNull();
		expect(h.target.querySelector('svg')).not.toBeNull();
		h.cleanup();
	});

	it('defaults to size 14', () => {
		const h = mountIcon('notes.txt');
		const svg = h.target.querySelector('svg.fti')!;
		expect(svg.getAttribute('width')).toBe('14');
		expect(svg.getAttribute('height')).toBe('14');
		expect(svg.getAttribute('viewBox')).toBe('0 0 28 28');
		h.cleanup();
	});

	it('honours an explicit size prop', () => {
		const h = mountIcon('notes.txt', 28);
		const svg = h.target.querySelector('svg.fti')!;
		expect(svg.getAttribute('width')).toBe('28');
		expect(svg.getAttribute('height')).toBe('28');
		h.cleanup();
	});

	it('propagates size to the delegated code square', () => {
		const h = mountIcon('app.ts', 20);
		const svg = h.target.querySelector('svg')!;
		expect(svg.getAttribute('width')).toBe('20');
		expect(svg.getAttribute('height')).toBe('20');
		h.cleanup();
	});

	it('glyph is decorative: aria-hidden and currentColor body', () => {
		const h = mountIcon('notes.txt');
		const svg = h.target.querySelector('svg.fti')!;
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.querySelector('path:not(.fold)')?.getAttribute('fill')).toBe('currentColor');
		h.cleanup();
	});
});
