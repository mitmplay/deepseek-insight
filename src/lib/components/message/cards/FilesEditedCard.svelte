<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import FilesEditedDiff from './FilesEditedDiff.svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { getConversationSession } from '$lib/services/conversation/session-context.svelte';
	/**
	 * FilesEditedCard — one completed turn's changed-files announcement
	 * (Edited-Files Card, ADR 2026-09-25): the wire event carried only
	 * { turn } (D1); this card borrows the summary from the Host at
	 * render time through the proxy route (D2). DSH-parity behaviors
	 * (2026-09-25, operator request — D4 widened): the card starts as a
	 * COLLAPSED chip (the think-chip pattern — fetch waits for the
	 * expand click); hovering a file row highlights it, and a hover held
	 * ≥2s fetches and shows that file's diff (Host changes.diff, index).
	 * The summary is NEVER persisted — when the Host can no longer
	 * answer (Session disposed), the chip degrades to the count-less
	 * strip label. XSS posture: every field renders as a TEXT node — no
	 * {@html} sink (BC-12).
	 */

	let { turn, seq }: { turn: number; seq: number } = $props();

	interface EditedFile {
		path: string;
		display: string;
		added: number;
		deleted: number;
		binary?: true;
		oversized?: true;
	}
	interface Summary {
		turn: number;
		files: EditedFile[];
		total: number;
		added: number;
		deleted: number;
	}
	interface DiffHunk {
		oldStart: number;
		oldLines: number;
		newStart: number;
		newLines: number;
		lines: string[];
	}
	interface TextFileDiff {
		kind: 'text';
		/** Wire: the file's real path — drives language pickup. */
		path?: string;
		display?: string;
		hunks?: DiffHunk[];
	}
	interface BinaryFileDiff {
		kind: 'binary';
	}
	interface OversizedFileDiff {
		kind: 'oversized';
	}
	type FileDiff = TextFileDiff | BinaryFileDiff | OversizedFileDiff;

	let open = $state(false);
	let summary = $state<Summary | null>(null);
	let gone = $state(false);
	let started = false;

	// Context reads belong to component INIT (Svelte 5 rule) — captured
	// once here, consumed by the fetch effects below.
	const sessionId = getConversationSession();

	async function loadSummary(): Promise<void> {
		if (sessionId === null) {
			gone = true;
			return;
		}
		try {
			const res = await fetch(
				`/api/dsh/session/${encodeURIComponent(sessionId)}/changes?seq=${seq}&turn=${turn}`
			);
			const body = (await res.json()) as { ok?: boolean; summary?: Summary };
			if (res.ok && body?.ok === true && body.summary) summary = body.summary;
			else gone = true;
		} catch {
			gone = true;
		}
	}

	function toggle(): void {
		open = !open;
		if (open && !started) {
			started = true;
			void loadSummary();
		}
	}

	// ── Hover-diff (highlight immediately, diff after 1s — shortened from
	// the DSH 2s parity value, operator request 2026-09-25) ──
	const HOVER_DIFF_MS = 1000;
	let hovered = $state<number | null>(null);
	let diff = $state<FileDiff | null>(null);
	let diffLoading = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	const textDiff = $derived(diff?.kind === 'text' ? diff : null);
	let diffSeq = 0;

	function rowEnter(index: number): void {
		clearTimeout(hoverTimer);
		hovered = index;
		hoverTimer = setTimeout(() => {
			void loadDiff(index);
		}, HOVER_DIFF_MS);
	}

	function rowLeave(): void {
		clearTimeout(hoverTimer);
		hovered = null;
	}

	async function loadDiff(index: number): Promise<void> {
		if (sessionId === null) return;
		const ticket = ++diffSeq;
		diffLoading = true;
		try {
			const res = await fetch(
				`/api/dsh/session/${encodeURIComponent(sessionId)}/changes?seq=${seq}&turn=${turn}&index=${index}`
			);
			const body = (await res.json()) as { ok?: boolean; diff?: FileDiff };
			if (ticket === diffSeq && res.ok && body?.ok === true && body.diff) diff = body.diff;
			else if (ticket === diffSeq) diffLoading = false;
		} catch {
			if (ticket === diffSeq) diffLoading = false;
		}
	}

</script>

<div class="self-start text-xs" data-testid="files-edited-section" data-open={open}>
	<button
		type="button"
		onclick={toggle}
		aria-expanded={open}
		data-testid="files-edited-toggle"
		class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium
		mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
		{open
			? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
			: 'bg-surface-alt text-text-secondary border border-surface-border hover:bg-surface-hover hover:text-text-primary'}"
	>
		{#if open}
			<ChevronDown size={10} />
		{:else}
			<ChevronRight size={10} />
		{/if}
		<span class="text-[10px]">{t(() => m.editedFilesChip())}</span>
	</button>

	{#if open}
		{#if summary}
			{@const s = summary}
			<div
				class="my-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] ring-1 ring-slate-200"
				data-testid="files-edited-card"
			>
				<div class="mb-1 font-medium text-slate-600">
					{#if s.total === 1}
						{t(m.editedFilesTitleOne)}
					{:else}
						{t(() => m.editedFilesTitle({ count: s.total }))}
					{/if}
				</div>
				<ul class="space-y-0.5">
					{#each s.files as file, i (file.path)}
						<li
							class="flex items-center gap-2 rounded px-1 -mx-1 transition-colors
							{hovered === i ? 'bg-white ring-1 ring-slate-300' : ''}"
							data-testid="files-edited-file"
							onmouseenter={() => rowEnter(i)}
							onmouseleave={rowLeave}
						>
							<span class="min-w-0 flex-1 truncate text-slate-700">{file.display}</span>
							{#if file.binary === true}
								<span class="text-slate-400">{t(m.editedFilesBinary)}</span>
							{:else if file.oversized === true}
								<span class="text-slate-400">{t(m.editedFilesOversized)}</span>
							{:else}
								<span class="font-mono text-emerald-600">{t(() => m.editedFilesAdded({ count: file.added }))}</span>
								<span class="font-mono text-red-500">{t(() => m.editedFilesDeleted({ count: file.deleted }))}</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if s.files.length < s.total}
					<div class="mt-1 text-slate-400">
						{t(() => m.editedFilesCapHint({ count: s.total - s.files.length }))}
					</div>
				{/if}
				{#if textDiff}
					<FilesEditedDiff diff={textDiff} />
				{:else if diff && diff.kind === 'binary'}
					<div class="mt-1 text-slate-400">{t(m.editedFilesBinary)}</div>
				{:else if diff && diff.kind === 'oversized'}
					<div class="mt-1 text-slate-400">{t(m.editedFilesOversized)}</div>
				{:else if diffLoading}
					<div class="mt-1.5 text-slate-400" data-testid="files-edited-diff-loading">…</div>
				{/if}
			</div>
		{:else if gone}
			<div
				class="my-1 rounded-lg bg-slate-50 px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-slate-200"
				data-testid="files-edited-gone"
			>
				{t(m.editedFilesGone)}
			</div>
		{/if}
	{/if}
</div>
