<!--
	CanvasCopyButton — capture a DOM element as PNG: click copies to clipboard,
	Shift+Click saves as file (OCI port, 2026-08-22).

	OCI's tiling logic verbatim: tall elements render in vertical tiles at
	full 2× (staying under html-to-image's 16,384 clamp) then composite onto
	one canvas sized to the browser's probed real limit; normal elements do
	one skipAutoScale pass. State machine idle → busy → done mirrors
	CopyButton feedback.

	Color contract (The Opaque Backing ADR, 2026-09-07): every capture paints
	the opaque CAPTURE_BACKING floor under the content, so the exported PNG
	owns its colors on any paste target; the element's translucent skin
	(computed oklab tints) stays in the SVG overlay.
-->
<script lang="ts">
	import { ImageIcon as CaptureIcon, Check, Loader2 } from '@lucide/svelte';
	import { toBlob, toCanvas } from 'html-to-image';

	let {
		container,
		title = 'Copy canvas as image (Shift+Click to save)',
		size = 12,
		class: className = ''
	}: {
		container: HTMLElement | null | undefined;
		title?: string;
		size?: number;
		class?: string;
	} = $props();

	let state = $state<'idle' | 'busy' | 'done'>('idle');

	const DESIRED_RATIO = 2;
	// Each vertical tile covers this many element-px.
	// At DESIRED_RATIO = 2 → 16,000 canvas px per tile, staying under
	// html-to-image's internal 16,384 checkCanvasDimensions limit.
	const TILE_HEIGHT = 7900;

	/**
	 * The capture's floor color — mirrors --color-surface (app.css:14),
	 * the color the operator sees behind a bubble. html-to-image fillRects
	 * this over the WHOLE canvas before drawing, so a translucent computed
	 * background here shipped a mostly-transparent PNG whose colors were
	 * decided by the paste target (The Opaque Backing ADR, 2026-09-07).
	 */
	const CAPTURE_BACKING = '#f8f9fa';

	let _maxCanvasSide: number | null = null;

	/**
	 * Probe the browser's true max canvas dimension via binary search.
	 * Chrome ≈ 32,767 · Safari ≈ 16,384 · Firefox ≈ 32,767.
	 * Cached after first call.
	 */
	function getMaxCanvasSide(): number {
		if (_maxCanvasSide != null) return _maxCanvasSide;
		try {
			let lo = 4096;
			let hi = 65535;
			while (lo < hi) {
				const mid = Math.ceil((lo + hi + 1) / 2);
				const c = document.createElement('canvas');
				c.width = mid;
				c.height = 1;
				if (c.getContext('2d')) lo = mid;
				else hi = mid - 1;
			}
			_maxCanvasSide = lo;
		} catch {
			_maxCanvasSide = 16384;
		}
		return _maxCanvasSide;
	}

	/**
	 * Render an element to a PNG Blob. For tall elements, renders in
	 * vertical tiles at full 2× quality, then composites onto one canvas.
	 *
	 * Why: html-to-image creates a single SVG <foreignObject> for the
	 * entire element, and its internal checkCanvasDimensions() clamps at
	 * a hardcoded 16,384. Browsers also degrade SVG rasterisation quality
	 * for very large images. Tiling keeps each render small and high-fidelity;
	 * the composite canvas is sized to the browser's real limit (probed
	 * at runtime, not hardcoded).
	 */
	async function renderElement(el: HTMLElement): Promise<Blob> {
		const rect = el.getBoundingClientRect();
		const w = rect.width;
		const h = rect.height;

		// Composite canvas ratio: as close to 2× as the browser allows
		const maxSide = getMaxCanvasSide();
		const ratio = Math.min(DESIRED_RATIO, maxSide / Math.max(w, 1), maxSide / Math.max(h, 1));

		const tileCount = Math.ceil(h / TILE_HEIGHT);

		// Normal-sized element: single pass, skipAutoScale to avoid
		// library's conservative 16384 clamp. The style pin keeps the clone
		// at its live border-box width: Chrome keeps a percentage max-width
		// (max-w-[80%]) UNRESOLVED in the copied computed style, and the
		// foreignObject re-resolves it against the clone's own width — the
		// border box shrank to 80% of the artifact (The Opaque Backing ADR
		// addendum, 2026-09-08).
		if (tileCount <= 1) {
			const blob = await toBlob(el, {
				pixelRatio: ratio,
				backgroundColor: CAPTURE_BACKING,
				skipAutoScale: true,
				style: { width: `${w}px`, maxWidth: 'none' }
			});
			if (!blob) throw new Error('toBlob returned null');
			return blob;
		}

		// Tall element: tile → composite
		const outW = Math.ceil(w * ratio);
		const outH = Math.ceil(h * ratio);

		const canvas = document.createElement('canvas');
		canvas.width = outW;
		canvas.height = outH;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');

		ctx.fillStyle = CAPTURE_BACKING;
		ctx.fillRect(0, 0, outW, outH);

		for (let i = 0; i < tileCount; i++) {
			const yOff = i * TILE_HEIGHT;
			const tH = Math.min(TILE_HEIGHT, h - yOff);

			// Render this slice at full 2× — SVG stays small, quality stays high
			// skipAutoScale prevents library's 16384 clamp on the tile canvas
			const tile = await toCanvas(el, {
				pixelRatio: DESIRED_RATIO,
				width: w,
				height: tH,
				style: { transform: `translateY(-${yOff}px)`, maxWidth: 'none' },
				backgroundColor: CAPTURE_BACKING,
				skipAutoScale: true
			});

			// Draw tile onto the composite at the correct position
			ctx.drawImage(tile, 0, Math.round(yOff * ratio), outW, Math.ceil(tH * ratio));
		}

		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), 'image/png');
		});
	}

	function getCaptureTarget(): HTMLElement | null {
		if (!container) return null;
		// Capture the full scrollable content, not just the visible viewport —
		// but only when the container actually CLIPS (a real scroll container).
		// A visible-overflow box reports content extent as scrollHeight without
		// hiding anything; hijacking to the first child there captured the
		// unstyled inner div and lost the skin entirely (The Opaque Backing
		// ADR, 2026-09-07 — Wave 2 finding on the real app).
		if (
			container.scrollHeight > container.clientHeight &&
			container.firstElementChild instanceof HTMLElement
		) {
			// Whitelist the clipping values — an unset/visible box never hides
			// content, and empty computed values must not read as clipping.
			const CLIPPING = new Set(['auto', 'scroll', 'hidden', 'clip']);
			const cs = getComputedStyle(container);
			if (CLIPPING.has(cs.overflowY) || CLIPPING.has(cs.overflowX)) {
				return container.firstElementChild as HTMLElement;
			}
		}
		return container;
	}

	async function copyToClipboard(): Promise<void> {
		const target = getCaptureTarget();
		if (!target) return;
		const blob = await renderElement(target);
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
	}

	async function saveAsFile(): Promise<void> {
		const target = getCaptureTarget();
		if (!target) return;
		const blob = await renderElement(target);
		const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `canvas-${ts}.png`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleAction(e: MouseEvent): Promise<void> {
		e.stopPropagation();
		if (!container) return;
		state = 'busy';
		try {
			if (e.shiftKey) {
				await saveAsFile();
			} else {
				await copyToClipboard();
			}
			state = 'done';
			setTimeout(() => (state = 'idle'), 2000);
		} catch {
			state = 'idle';
		}
	}
</script>

<button type="button" class="{className}" {title} data-testid="canvas-copy-button" onclick={handleAction}>
	{#if state === 'done'}
		<Check {size} class="text-green-500" />
	{:else if state === 'busy'}
		<Loader2 {size} class="animate-spin" />
	{:else}
		<CaptureIcon {size} />
	{/if}
</button>
