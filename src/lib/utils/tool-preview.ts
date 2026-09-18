/**
 * tool-preview — peek-list args preview (OCI extractArgsPreview port,
 * 2026-08-22). Pure function: raw arguments JSON → one-line hint so the
 * peek list answers "which call is which" before opening any chip.
 *
 * DSH tool args shapes (pinned by the wire: tool/call.data.arguments):
 *   bash/pwsh   {cmd}           ·  grep/glob {pattern, path}
 *   read        {path}          ·  web_fetch {url}
 *   web_search  {query}         ·  write/edit {path}
 * Generic ladder: path → cmd/command → pattern → query → url → input.path
 * → first string value. Non-JSON falls back to the raw text (120-char cap).
 */

/** Max raw-text fallback length before ellipsis. */
const RAW_CAP = 120;

export function extractArgsPreview(toolName: string, args: string | undefined): string {
	if (!args) return '';
	try {
		const parsed = JSON.parse(args) as Record<string, unknown>;
		if (typeof parsed.path === 'string') return parsed.path;
		if (typeof parsed.cmd === 'string') return parsed.cmd;
		if (typeof parsed.command === 'string') return parsed.command;
		if (typeof parsed.pattern === 'string') return parsed.pattern;
		if (typeof parsed.query === 'string') return parsed.query;
		if (typeof parsed.url === 'string') return parsed.url;
		if (parsed.input && typeof parsed.input === 'object' && typeof (parsed.input as Record<string, unknown>).path === 'string') {
			return (parsed.input as Record<string, string>).path;
		}
		for (const v of Object.values(parsed)) {
			if (typeof v === 'string') return v;
		}
	} catch {
		// Not JSON — raw fallback below.
	}
	void toolName; // reserved for shape-specific branches when the wire grows
	return args.length > RAW_CAP ? `${args.slice(0, RAW_CAP)}…` : args;
}
