// @vitest-environment node
/**
 * Live error-code contract (the alpha-jump pin, 2026-09-01) — DSH_LIVE=1 gated.
 *
 * Pins the host's rejection vocabulary exactly where DSI's matchers branch on
 * it, so the next wholesale code rename (0.1.2-alpha.2's did: `internal` →
 * `gateway/internal`, `session-not-found` → `session/not-found`) fails HERE
 * instead of as a wrong-flavored error card in the UI. Every probe rides DSI's
 * own production primitives — DshAuth cookie mint, encodeRequest/parseResponse,
 * and the dsh-connection singleton's history() (the +page.server.ts path):
 *   1. session.list round trip — proves the 0.1.2 cookie fence is crossed
 *   2. history() on a missing session → 'session/not-found' (page.server 404)
 *   3. history() on a subagent child → the 'subagent/*' family (page.server 409)
 *   4. $events/result for an unknown client/event → the lost-race door's code
 *      (the answerer's "answered elsewhere" branch; renamed codes observed
 *      2026-09-01 on 0.1.2-alpha.3 are pinned verbatim below)
 *
 * Skips cleanly (exit 0) when DSH_LIVE is unset (BC-8: an absent host must
 * never fail CI); fails fast with a clear message when DSH_LIVE=1 but the
 * host is unreachable.
 */

import { describe, expect, it } from 'vitest';
import { dshBaseUrl } from '$lib/config';
import { getDshConnection } from '$lib/server/dsh-connection';
import {
	DshAuth,
	DshRpcError,
	REMOTE_EVENT_RESULT_ENDPOINT,
	encodeRequest,
	parseResponse,
	rpcUrl
} from '$lib/server/dsh-rpc';

const liveGate = process.env.DSH_LIVE === '1';

describe.skipIf(!liveGate)('DSH live error-code contract', { timeout: 30_000 }, () => {
	it('1. session.list round-trips through the cookie fence (DSI primitives)', async () => {
		const rows = await getDshConnection().listSessions();
		expect(Array.isArray(rows.items)).toBe(true);
	});

	it('2. history() on a missing session rejects session/not-found (page.server 404 branch)', async () => {
		const err = await getDshConnection()
			.history('session-dsi-probe-missing')
			.then(
				() => null,
				(e) => e
			);
		expect(err).toBeInstanceOf(DshRpcError);
		expect((err as DshRpcError).code).toBe('session/not-found');
	});

	it('3. history() on a subagent child by plain id rejects session/agent-busy (the 409 branch)', async () => {
		// Re-pinned 2026-09-04 on 0.1.3-alpha.1 (and true at rc.1 — the
		// validation is byte-identical there; the 2026-09-04 morning pass was
		// vacuous because the host then held no children and this probe
		// returned early): the host REFUSES plain-id child pages with
		// session/agent-busy "requires their durable parent address" — a
		// member of SUBAGENT_REJECTION_CODES, so page.server renders its 409
		// card and DSI never mistakes the refusal for a transport failure.
		// (0.1.2-alpha.3, 2026-09-01, had served this form.)
		const conn = getDshConnection();
		const { items } = await conn.listSessions();
		// The busy-refusal only applies to a LIVE child — an idle child's
		// plain-id history is served normally (2026-09-14 drift pass: a
		// finished child on this host answered 200, vacating the probe).
		const child = items.find((r) => r.origin === 'subagent' && r.running === true);
		if (!child) return; // no LIVE children on this host right now — nothing to probe
		const err = await conn.history(child.sessionId).then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(DshRpcError);
		expect((err as DshRpcError).code).toBe('session/agent-busy');
	});

	it('4. $events/result for an unknown client answers a gateway/* code (the lost-race door)', async () => {
		const rpcId = `dsi-probe-${Math.random().toString(36).slice(2, 8)}`;
		const cookie = await new DshAuth().ensureCookie();
		const method = REMOTE_EVENT_RESULT_ENDPOINT;
		const res = await fetch(rpcUrl(dshBaseUrl(), method), {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(cookie === null ? {} : { cookie }) },
			body: encodeRequest(rpcId, method, {
				args: {
					clientId: 'dsi-probe-no-such-client',
					eventId: 'dsi-probe-no-such-event',
					outcome: { kind: 'result', value: { sessionId: 'dsi-probe', outcome: 'rejected' } }
				}
			}),
			signal: AbortSignal.timeout(8000)
		});
		expect(res.status).toBe(200);
		const body = await res.text();
		// Live-pinned 2026-09-01 on 0.1.2-alpha.3: an unknown clientId folds to
		// gateway/internal with the verbatim gateway message — the old wire's
		// bare `internal` code is gone. parseResponse throws the DshRpcError;
		// the assertion pins its code + message so the answerer's self-heal
		// branch tracks the real wire.
		expect(() => parseResponse(body, rpcId)).toThrowError(
			expect.objectContaining({
				code: 'gateway/internal',
				message: expect.stringContaining('no active event stream')
			})
		);
	});

	it('5. commands/execute rides the submittedAttachments envelope (the access-chip door)', async () => {
		// Pinned 2026-09-05 on 0.1.3-alpha.1: the Typert descriptor binds the
		// implementation's parameter name — CommandRuntime.execute's third
		// parameter is `submittedAttachments`, and the rc.1-era `images` (or
		// the client interface's `attachments`) reject with
		// gateway/arguments-invalid "missing submittedAttachments". That
		// rename silently killed every DSI slash command (the /permission
		// switch answered "switch failed — try again") because no probe ever
		// exercised the envelope. The pin: an UNREGISTERED command name —
		// descriptor validation passes (args shape accepted), the runtime
		// resolves no command, executeCommand returns null. Side-effect-free,
		// and it fails exactly when the envelope drifts again. The host
		// resolves the AGENT before the command name, so the probe targets
		// the first listed session with a command name that resolves nothing.
		const conn = getDshConnection();
		const { items } = await conn.listSessions();
		const anySession = items[0]?.sessionId;
		if (anySession === undefined) return; // empty host — nothing to probe
		const receipt = await conn.executeCommand(anySession, '/dsi-envelope-probe-not-a-command');
		expect(receipt).toBeNull();
	});
});