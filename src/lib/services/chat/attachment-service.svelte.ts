/**
 * Attachment service (task 1.2) — the draft lifecycle state machine.
 *
 * DSH semantics on an OCI-shaped factory (ADR D2): drafts are id-keyed
 * browser objects (kind/file/previewUrl) that never serialize before
 * submit; admission is loud and batch-honest — one unsupported media type
 * refuses the whole batch before any id is minted (ConversationController
 * createDraftImages parity); every object URL is revoked on remove/clear.
 * Limits (count/bytes from the host imageLimits projection) arrive in W4.
 */
import { bytesToBase64 } from '$lib/utils/base64';
import {
	DEFAULT_IMAGE_LIMITS,
	type DsiImageLimits
} from '$lib/services/conversation/image-limits';

/** Media types the DSH wire schema accepts (imageMediaTypeSchema) — the W4 fallback set. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** A browser-owned image draft; only its id ever enters input state. */
export interface AttachmentDraft {
	kind: 'image';
	id: string;
	file: File;
	mediaType: ImageMediaType;
	previewUrl: string;
}

/** Wire-shaped serialized image (session.prompt image part body). */
export interface SerializedImage {
	mediaType: ImageMediaType;
	data: string;
	name?: string;
}

/** Refuse the whole batch when one file's type is not on the wire whitelist. */
export class UnsupportedMediaTypeError extends Error {
	constructor(readonly mediaType: string) {
		super(`unsupported image media type: ${mediaType || '(empty)'}`);
		this.name = 'UnsupportedMediaTypeError';
	}
}

/** Refuse the whole batch when the HOST's admission numbers say no
 *  (task 4.2, BC-A6): the reason names the offending file and the host's
 *  own limit — never a hardcoded guess. */
export class AttachmentLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AttachmentLimitError';
	}
}

/** Human byte formatting for limit reasons (B/KB/MB, one decimal). */
export function formatLimitBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Create a draft-attachment service instance.
 *
 * @param limits - the host's admission numbers (imageLimits projection;
 * defaults to the DSH documented values — BC-A6: the pre-flight reads the
 * host's limits, never hardcoded guesses).
 * @returns reactive draft list plus lifecycle methods; object URLs are
 * tracked for revocation and never outlive their draft.
 */
export function createAttachmentService(limits: DsiImageLimits = DEFAULT_IMAGE_LIMITS) {
	let drafts = $state<AttachmentDraft[]>([]);
	const ownedUrls = new Set<string>();

	function revoke(url: string): void {
		if (!ownedUrls.delete(url)) return;
		URL.revokeObjectURL(url);
	}

	/**
	 * Admit files as id-keyed drafts. Validates every file first — an
	 * unsupported type OR a limit violation refuses the whole batch before
	 * any state changes (batch-loud, DSH createDraftImages/saveImages
	 * posture): count against maxImagesPerMessage (existing drafts count),
	 * per-file bytes against maxImageBytes, and the batch's aggregate
	 * against maxMessageImageBytes.
	 *
	 * @param files - browser files (picker, paste, or drop).
	 */
	function addFiles(files: File[]): void {
		for (const file of files) {
			if (!(limits.mediaTypes as readonly string[]).includes(file.type)) {
				throw new UnsupportedMediaTypeError(file.type);
			}
		}
		if (files.length > 0) {
			if (drafts.length + files.length > limits.maxImagesPerMessage) {
				throw new AttachmentLimitError(
					`too many images: ${drafts.length + files.length} of ${limits.maxImagesPerMessage} allowed per message`
				);
			}
			for (const file of files) {
				if (file.size > limits.maxImageBytes) {
					throw new AttachmentLimitError(
						`${file.name || 'image'} is ${formatLimitBytes(file.size)} — the limit is ${formatLimitBytes(limits.maxImageBytes)} per image`
					);
				}
			}
			const aggregate = drafts.reduce((sum, d) => sum + d.file.size, 0) + files.reduce((sum, f) => sum + f.size, 0);
			if (aggregate > limits.maxMessageImageBytes) {
				throw new AttachmentLimitError(
					`images total ${formatLimitBytes(aggregate)} — the limit is ${formatLimitBytes(limits.maxMessageImageBytes)} per message`
				);
			}
		}
		const admitted = files.map((file) => {
			const previewUrl = URL.createObjectURL(file);
			ownedUrls.add(previewUrl);
			return {
				kind: 'image',
				id: crypto.randomUUID(),
				file,
				mediaType: file.type as ImageMediaType,
				previewUrl
			} satisfies AttachmentDraft;
		});
		drafts = [...drafts, ...admitted];
	}

	/**
	 * Remove one draft by id and revoke its preview URL.
	 *
	 * @param id - draft id (chips remove by id, never by index).
	 */
	function removeAttachment(id: string): void {
		const draft = drafts.find((d) => d.id === id);
		if (draft === undefined) return;
		revoke(draft.previewUrl);
		drafts = drafts.filter((d) => d.id !== id);
	}

	/** Remove every draft and revoke every owned URL (after an admitted send). */
	function clear(): void {
		for (const draft of drafts) revoke(draft.previewUrl);
		drafts = [];
	}

	/**
	 * Serialize drafts to wire payloads — the ONLY moment base64 exists
	 * (BC-A2: nothing serializes before submit).
	 *
	 * @param ids - ordered draft ids; omitted means all drafts in order.
	 * @returns base64 image parts; unknown ids are skipped (a removed draft
	 * never blocks its siblings).
	 */
	async function serialize(ids?: string[]): Promise<SerializedImage[]> {
		const ordered = ids === undefined ? drafts : ids.flatMap((id) => drafts.filter((d) => d.id === id));
		return Promise.all(
			ordered.map(async (draft) => ({
				mediaType: draft.mediaType,
				data: bytesToBase64(new Uint8Array(await draft.file.arrayBuffer())),
				...(draft.file.name === '' ? {} : { name: draft.file.name })
			}))
		);
	}

	return {
		get drafts() {
			return drafts;
		},
		get count() {
			return drafts.length;
		},
		addFiles,
		removeAttachment,
		clear,
		serialize
	};
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
