/**
 * Relative time formatting for session cards and message bubbles.
 */

/** Turn wall time, DSH `formatRunDuration` parity: "2m 08s" past a minute, else "19s". */
export function formatRunDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Compact relative time: "just now" → "5m ago" → "3h ago" → "2d ago" → date. */
export function relativeTime(ms: number, now: number = Date.now()): string {
	const delta = Math.max(0, now - ms);
	const seconds = Math.floor(delta / 1000);
	if (seconds < 10) return 'just now';
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const date = new Date(ms);
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}
