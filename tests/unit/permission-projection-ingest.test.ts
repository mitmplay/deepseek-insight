/**
 * permissionFromProjection ingester tests — the 2026-09-16 chip-hidden
 * bug: the host's PermissionSelection is { currentValue } ONLY (options
 * live in DSH's process catalog), so the ingester must serve the local
 * table as the menu instead of declining the whole projection (which
 * left AccessModeChip's permission !== null gate closed forever).
 */

import { describe, expect, it } from 'vitest';
import {
	localPermission,
	permissionFromProjection
} from '$lib/services/conversation/permission-state';

describe('permissionFromProjection — the live host wire', () => {
	it('accepts the host\'s { currentValue }-only shape and serves the local table', () => {
		const result = permissionFromProjection({ currentValue: 'workspace-write' });
		expect(result).not.toBeUndefined();
		expect(result?.current).toBe('workspace-write');
		expect(result?.options).toEqual(localPermission().options);
		expect(result?.options.map((o) => o.value)).toContain('read-only');
		expect(result?.options.map((o) => o.value)).not.toContain('custom');
	});

	it('accepts danger-full-access (approval never) without a preset event basis', () => {
		const result = permissionFromProjection({ currentValue: 'danger-full-access' });
		expect(result?.current).toBe('danger-full-access');
	});

	it('still declines a payload with no current value', () => {
		expect(permissionFromProjection({})).toBeUndefined();
		expect(permissionFromProjection({ options: [] })).toBeUndefined();
		expect(permissionFromProjection(null)).toBeUndefined();
	});

	it('shipped options stay authoritative and keep the strict ingest', () => {
		const result = permissionFromProjection({
			currentValue: 'read-only',
			options: [
				{ value: 'read-only', name: 'Read Only', description: 'read only' },
				{ value: 'custom' }
			]
		});
		expect(result?.options.length).toBe(1);
		expect(result?.options[0]).toEqual({
			value: 'read-only',
			label: 'Read Only',
			description: 'read only'
		});
	});

	it('shipped-but-empty options still decline (the conservative arm)', () => {
		expect(permissionFromProjection({ currentValue: 'read-only', options: [] })).toBeUndefined();
		expect(
			permissionFromProjection({ currentValue: 'read-only', options: [{ value: 'custom' }] })
		).toBeUndefined();
	});
});
