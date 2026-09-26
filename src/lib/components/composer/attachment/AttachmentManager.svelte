<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * AttachmentManager (task 1.3) — the attachment doorman. Owns ONE
	 * attachment-service instance and every entry point that feeds it:
	 * paperclip + hidden multi-file input, paste forwarding (image items
	 * only), and a document-level drag-and-drop overlay with depth counting
	 * (OCI Manager shape; DSH ComposerAttachments drop semantics).
	 *
	 * Thin by contract: no validation logic lives here — the service owns
	 * admission. Exposes clear/removeAttachment/serialize/handlePaste to
	 * the parent; drafts sync up via the bindable prop.
	 */
	import { Paperclip } from '@lucide/svelte';
	import {
		createAttachmentService,
		formatLimitBytes,
		type AttachmentDraft,
		type SerializedImage
	} from '$lib/services/chat/attachment-service.svelte';
	import { DEFAULT_IMAGE_LIMITS, type DsiImageLimits } from '$lib/services/conversation/image-limits';

	let {
		disabled = false,
		limits = DEFAULT_IMAGE_LIMITS,
		drafts = $bindable([] as AttachmentDraft[])
	}: {
		disabled?: boolean;
		/** The host's admission numbers (imageLimits projection; panel-threaded —
		 *  DSH documented defaults when the cold load carried none, BC-A6). */
		limits?: DsiImageLimits;
		/** Draft list mirrored from the owned service (parent renders chips). */
		drafts?: AttachmentDraft[];
	} = $props();

	// svelte-ignore state_referenced_locally
	// Deliberate const-capture: limits are the cold load's projection value —
	// fixed for this panel's lifetime (a session switch remounts the panel,
	// and with it the service); no mid-flight limit swaps exist on the wire.
	const svc = createAttachmentService(limits);

	$effect(() => {
		drafts = svc.drafts;
	});

	let fileInput = $state<HTMLInputElement | null>(null);
	let dragActive = $state(false);
	/** Document-wide drag depth: enter +1, leave -1 — nested elements cancel out. */
	let dragDepth = 0;
	/** Admission failure note (role=alert); auto-dismisses after 5s. */
	let note = $state<string | null>(null);
	let noteTimer: ReturnType<typeof setTimeout> | undefined;

	function showNote(text: string): void {
		note = text;
		if (noteTimer !== undefined) clearTimeout(noteTimer);
		noteTimer = setTimeout(() => (note = null), 5_000);
	}

	function admit(files: File[]): void {
		if (files.length === 0) return;
		try {
			svc.addFiles(files);
		} catch (err) {
			showNote(err instanceof Error ? err.message : String(err));
		}
	}

	export function clear(): void {
		svc.clear();
	}

	export function removeAttachment(id: string): void {
		svc.removeAttachment(id);
	}

	/** The ONLY base64 moment — called by the parent at submit time (BC-A2). */
	export function serialize(ids?: string[]): Promise<SerializedImage[]> {
		return svc.serialize(ids);
	}

	/** Paste forwarding: image clipboard items become drafts; text stays text. */
	export function handlePaste(e: ClipboardEvent): void {
		const items = e.clipboardData?.items;
		if (items === undefined) return;
		const images = Array.from(items)
			.filter((item) => item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
		if (images.length === 0) return;
		e.preventDefault();
		admit(images);
	}

	function handleAttachmentClick(): void {
		fileInput?.click();
	}

	function handleFileSelect(e: Event): void {
		const input = e.target as HTMLInputElement;
		if (input.files !== null) admit(Array.from(input.files));
		input.value = '';
	}

	/** Only count drags that carry files (DSH fileTransfer check). */
	function fileTransfer(e: DragEvent): boolean {
		return e.dataTransfer?.types.includes('Files') ?? false;
	}

	$effect(() => {
		const onDragEnter = (e: DragEvent): void => {
			if (!fileTransfer(e)) return;
			e.preventDefault();
			dragDepth += 1;
			dragActive = true;
		};
		const onDragOver = (e: DragEvent): void => {
			if (!fileTransfer(e)) return;
			e.preventDefault();
			if (e.dataTransfer !== null) e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
		};
		const onDragLeave = (e: DragEvent): void => {
			if (!fileTransfer(e)) return;
			dragDepth = Math.max(0, dragDepth - 1);
			if (dragDepth === 0) dragActive = false;
		};
		const onDrop = (e: DragEvent): void => {
			if (!fileTransfer(e)) return;
			e.preventDefault();
			dragDepth = 0;
			dragActive = false;
			if (!disabled && e.dataTransfer !== null) admit(Array.from(e.dataTransfer.files));
		};
		const reset = (): void => {
			dragDepth = 0;
			dragActive = false;
		};
		document.addEventListener('dragenter', onDragEnter);
		document.addEventListener('dragover', onDragOver);
		document.addEventListener('dragleave', onDragLeave);
		document.addEventListener('drop', onDrop);
		window.addEventListener('dragend', reset);
		return () => {
			document.removeEventListener('dragenter', onDragEnter);
			document.removeEventListener('dragover', onDragOver);
			document.removeEventListener('dragleave', onDragLeave);
			document.removeEventListener('drop', onDrop);
			window.removeEventListener('dragend', reset);
		};
	});
</script>

<input
	bind:this={fileInput}
	type="file"
	multiple
	accept={limits.mediaTypes.join(',')}
	onchange={handleFileSelect}
	data-testid="attach-input"
	class="sr-only"
	aria-hidden="true"
	tabindex="-1"
/>

<button
	type="button"
	onclick={handleAttachmentClick}
	disabled={disabled}
	title={t(m.attachImages)}
	aria-label={t(m.attachImages)}
	data-testid="attach-button"
	class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-30"
>
	<Paperclip size={16} />
</button>

{#if note}
	<div role="alert" data-testid="attach-note" class="text-xs text-red-600">{note}</div>
{/if}

{#if dragActive}
	<div
		data-testid="drop-overlay"
		class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
	>
		<p class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg">
			{disabled
				? t(m.cannotAttachLocked)
				: t(() => m.dropImagesToAttach({ n: limits.maxImagesPerMessage, bytes: formatLimitBytes(limits.maxImageBytes) }))}
		</p>
	</div>
{/if}
