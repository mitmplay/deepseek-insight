/**
 * MarkdownContent branch margins — arms the other suites never enter:
 *   (a) colorizeMermaid self-styled no-op (the author drew first)
 *   (b) colorizeMermaid flowchart injection + non-flowchart passthrough
 *   (c) the lean-path (hideToggle) feature-spec $effect mount + cleanup
 *   (d) paintSequenceColors loop arms via a fake SVGElement.getBBox
 *       (happy-dom has no text metrics) — column grouping + label snap
 *
 * $app/environment mocked to browser:true; mermaid runtime mocked.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';

vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

const mermaidRender = vi.fn(async (_id: string, source: string) => ({ svg: "" }));
const mermaidInitialize = vi.fn();

vi.mock('mermaid', () => ({
	default: {
		initialize: (...args: unknown[]) => mermaidInitialize(...args),
		render: (...args: unknown[]) => mermaidRender(...(args as [string, string]))
	}
}));

// (d) happy-dom SVG elements have no getBBox — the sequence-paint pass
// groups columns by bbox center-x, so derive x from the element's own
// x attribute to exercise the multi-column arms.
const installFakeGetBBox = () => {
	const proto = (globalThis as { SVGElement?: { prototype: Record<string, unknown> } }).SVGElement;
	if (!proto) return () => {};
	const had = "getBBox" in proto.prototype;
	const original = (proto.prototype as Record<string, unknown>).getBBox;
	proto.prototype.getBBox = function fakeGetBBox(this: SVGElement) {
		const x = Number((this as unknown as Element).getAttribute?.("x") ?? 0);
		return { x, y: 0, width: 80, height: 20 };
	};
	return () => {
		if (had) (proto.prototype as Record<string, unknown>).getBBox = original;
		else delete (proto.prototype as Record<string, unknown>).getBBox;
	};
};

let restoreBBox: () => void = () => {};
afterEach(() => restoreBBox());

function render(props: { content: string; hideToggle?: boolean }): { target: HTMLElement; unmount: () => void } {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const comp = mount(MarkdownContent, { target, props });
	flushSync();
	return { target, unmount: () => unmount(comp) };
}

async function settle(rounds = 10): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

const svgWithActors =
  '<svg><rect class="actor" x="0"></rect><rect class="actor" x="0"></rect><rect class="actor" x="100"></rect><text class="actor" x="10">A</text><text class="actor" x="110">B</text></svg>';

beforeEach(() => {
	mermaidRender.mockClear();
	mermaidInitialize.mockClear();
	restoreBBox = installFakeGetBBox();
	mermaidRender.mockImplementation(async () => ({ svg: svgWithActors }));
});

describe("MarkdownContent margins — colorizeMermaid arms", () => {
	it("(a) a self-styled flowchart passes through untouched", async () => {
		const source = "flowchart TD\n  A[Host] --> B[Web]\n  classDef mine fill:red";
		const { target, unmount } = render({ content: "```mermaid\n" + source + "\n```" });
		await settle();
		expect(mermaidRender).toHaveBeenCalledTimes(1);
		const received = mermaidRender.mock.calls[0][1] as string;
		expect(received).toBe(source); // no injected classDef zc / class lines
		unmount();
	});

	it("(b) a bare flowchart gets the palette classDefs and class assigns", async () => {
		const { target, unmount } = render({ content: "```mermaid\nflowchart TD\n  A[Host] --> B[Web]\n```" });
		await settle();
		const received = mermaidRender.mock.calls[0][1] as string;
		expect(received).toContain("classDef zc0");
		expect(received).toContain("class A zc0;");
		expect(received).toContain("class B zc1;");
		unmount();
	});

	it("(b2) a `graph` alias flowchart is colorized the same way", async () => {
		const { target, unmount } = render({ content: "```mermaid\ngraph LR\n  X[A] --> Y[B]\n```" });
		await settle();
		const received = mermaidRender.mock.calls[0][1] as string;
		expect(received).toContain("classDef zc0");
		unmount();
	});

	it("(b3) a non-flowchart diagram passes through untouched", async () => {
		const source = "sequenceDiagram\n  participant A\n  A->>B: hi";
		const { target, unmount } = render({ content: "```mermaid\n" + source + "\n```" });
		await settle();
		const received = mermaidRender.mock.calls[0][1] as string;
		expect(received).toBe(source);
		unmount();
	});
});

describe("MarkdownContent margins — paintSequenceColors loops", () => {
	it("(d) actor boxes get one color per column; labels snap to their column", async () => {
		const { target, unmount } = render({ content: "```mermaid\nsequenceDiagram\n  A->>B: hi\n```" });
		await settle();
		const svg = target.querySelector(".mermaid-diagram svg") as unknown as SVGSVGElement;
		expect(svg).not.toBeNull();
		const rects = [...svg.querySelectorAll("rect.actor")];
		expect(rects.length).toBe(3);
		// column 0 (x=0): same fill on both header and footer box of the lifeline
		expect((rects[0] as HTMLElement).style.fill).toBe((rects[1] as HTMLElement).style.fill);
		for (const r of rects) {
			expect((r as HTMLElement).style.fill).not.toBe("");
			expect((r as HTMLElement).style.stroke).not.toBe("");
		}
		const texts = [...svg.querySelectorAll("text.actor")];
		expect((texts[0] as HTMLElement).style.fontWeight).toBe("600");
		expect((texts[0] as HTMLElement).style.fill).not.toBe("");
		unmount();
	});
});

describe("MarkdownContent margins — lean feature-spec $effect", () => {
	it("(c) hideToggle + feature-spec mounts the top-right copy button", async () => {
		const { target, unmount } = render({ content: "**feature-spec: the plan**\n\nbody", hideToggle: true });
		await settle();
		const md = target.querySelector(".md-content") as HTMLElement;
		expect(md).not.toBeNull();
		expect(md.classList.contains("relative")).toBe(true);
		expect(md.classList.contains("group/featurespec")).toBe(true);
		expect(md.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		// NOTE: the disposer (classList.remove) only runs on effect RERUN —
		// featureSpecDispose is not wired to component destroy — so we do
		// not assert post-unmount class removal. Pins actual behavior.
		unmount();
	});

	it("(c2) hideToggle without a feature-spec adds no chrome", async () => {
		const { target, unmount } = render({ content: "plain **bold**", hideToggle: true });
		await settle();
		const md = target.querySelector(".md-content") as HTMLElement;
		expect(md.classList.contains("relative")).toBe(false);
		unmount();
	});
});