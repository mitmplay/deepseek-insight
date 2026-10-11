/** Test fixture: a reactive draft stand-in for the composer's $state value
 *  (runes only compile in .svelte.ts) — the controllers' effects must track
 *  it exactly like the real draft. */
export class DraftBox {
	value = $state('');
	constructor(initial: string) {
		this.value = initial;
	}
	set(v: string) {
		this.value = v;
	}
	get() {
		return this.value;
	}
}
