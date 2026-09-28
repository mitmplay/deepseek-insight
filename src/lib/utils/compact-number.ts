/** Compact number formatting for narrow UI badges: 1829 -> '1.8K',
 *  4200000 -> '4.2M'. Locale-stable ('en') so rack rows keep their width. */
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(n: number): string {
	return compact.format(n);
}
