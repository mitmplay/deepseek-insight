/**
 * api-dsh — POST /api/dsh/pick-directory
 *
 * The NATIVE folder pick for the Add-workspace flow (2026-08-24, DSH
 * parity): host.pickDirectory opens one OS chooser on the host's own
 * display (the auto backend mounts native on a local darwin/win32 host)
 * and resolves the picked absolute path — null when the operator cancels.
 * The browser request's abort follows through: closing the DSI panel
 * closes the host's dialog mid-choice.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const result = await getDshConnection().pickDirectory(request.signal);
		return json({ ok: true, path: result.path });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
