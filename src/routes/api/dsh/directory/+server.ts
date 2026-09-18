/**
 * api-dsh — GET /api/dsh/directory?path=…
 *
 * One browsed directory level for the Add-workspace folder picker
 * (2026-08-24, DSH parity: the directory-picker browse capability).
 * Absent path lists the host home directory. The browser never reaches
 * the DSH Host directly (BC-1); wire bytes live behind dsh-connection
 * (BC-6).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('path');
	if (raw !== null && raw.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-path', message: 'path must be a non-empty absolute path when present' } },
			{ status: 400 }
		);
	}

	try {
		const listing = await getDshConnection().listDirectory(raw === null ? undefined : raw);
		return json({ ok: true, listing });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
