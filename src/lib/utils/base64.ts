/**
 * Base64 codec — the DSH wire algorithm ported client-side
 * (harness ConversationController.encodeImage: 0x8000-byte windows through
 * String.fromCharCode, then btoa). Spreading a whole multi-MB image in one
 * call overflows the argument stack; the chunk loop keeps every call small.
 * Wave 3 adds the decode pair (attachment reads return canonical base64).
 */

/**
 * Encode bytes as canonical base64 (no data-URL prefix).
 *
 * @param data - raw bytes to encode.
 * @returns base64 string, empty string for empty input.
 */
export function bytesToBase64(data: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let offset = 0; offset < data.length; offset += chunk) {
		binary += String.fromCharCode(...data.subarray(offset, offset + chunk));
	}
	return btoa(binary);
}

/**
 * Decode canonical base64 to bytes (the read-path pair of bytesToBase64 —
 * session.attachment returns base64; the renderer needs bytes for a Blob).
 *
 * @param value - canonical base64 (no data-URL prefix).
 * @returns decoded bytes.
 */
export function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
