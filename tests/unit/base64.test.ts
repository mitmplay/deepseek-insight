/**
 * bytesToBase64 (task 1.1-T): known vectors, round-trip, and the 0x8000
 * chunk boundary — one byte either side of the window edge proves the
 * subarray loop joins windows without dropping or duplicating bytes.
 */
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '$lib/utils/base64';

describe('bytesToBase64', () => {
	it('encodes known vectors', () => {
		expect(bytesToBase64(new Uint8Array([]))).toBe('');
		expect(bytesToBase64(new Uint8Array([0]))).toBe('AA==');
		expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
		expect(bytesToBase64(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe('//79');
	});

	it('round-trips arbitrary bytes through atob', () => {
		const bytes = new Uint8Array(300);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) % 256;
		const decoded = atob(bytesToBase64(bytes));
		expect(decoded.length).toBe(bytes.length);
		for (let i = 0; i < bytes.length; i++) expect(decoded.charCodeAt(i)).toBe(bytes[i]);
	});

	it('crosses the 0x8000 chunk boundary without seam', () => {
		// 0x8000 exactly, one under, one over — three windows sizes, one answer each
		for (const size of [0x7fff, 0x8000, 0x8001, 0x10000]) {
			const bytes = new Uint8Array(size).fill(0x41);
			const encoded = bytesToBase64(bytes);
			// Base64 length is ceil(n/3) groups x 4 chars.
			expect(encoded.length).toBe(Math.ceil(size / 3) * 4);
			expect(atob(encoded).length).toBe(size);
		}
	});
});
