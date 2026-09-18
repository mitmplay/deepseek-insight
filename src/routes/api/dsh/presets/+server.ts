/**
 * api-dsh — GET /api/dsh/presets
 *
 * POC-2 W3: agentPreset.list through the choke point (BC-6) → picker rows
 * {ok:true, presets:[{id,name,description,isDefault}]}. The picker's only
 * source of truth — a preset the host doesn't list can't be created with.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const { presets } = await getDshConnection().listPresets();
		return json({ ok: true, presets });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
