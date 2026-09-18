/** Shared mutable fake for $app/state.page across stubs and tests. */
export const reactiveTestPage = $state({
	url: new URL('http://dsi/?sessionKey=s-test'),
	status: 200,
	error: null as App.Error | null,
	data: {},
	params: {}
});
