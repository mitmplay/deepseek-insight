<!--
	CodeFileIcon — Svelte port of deepseek-harness ui-primitives CodeFileIcon.tsx
	(DSH working tree c291e7961a, past dsh-v0.1.5-rc.1): one full-color 20px
	square glyph per language or configuration category, artwork VERBATIM from
	code-file-icon-artwork.ts (the generated design-export table). Gradient
	and clip-path ids carry the host's __DSH_CODE_ICON_INSTANCE__ token,
	replaced with $props.id() where DSH uses React useId — per-instance ids
	keep the embedded defs independent when several icons render together.
-->
<script lang="ts">
	import { CODE_FILE_ARTWORK, CODE_FILE_ICON_ID_TOKEN } from './code-file-icon-artwork';
	import type { CodeFileType } from './dsh-file-type';

	let { type, size = 14 }: { type: CodeFileType; size?: number } = $props();

	const uid = $props.id();
	const artwork = $derived(
		CODE_FILE_ARTWORK[type].replaceAll(CODE_FILE_ICON_ID_TOKEN, 'dsh-code-icon-' + uid)
	);
</script>

<svg width={size} height={size} viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
	{@html artwork}
</svg>
