/**
 * yaml-worker-entry — the Worker module DSI actually spawns for the yaml
 * language (RCA 2026-09-26). monaco-yaml's yaml.worker registers its RPC
 * handlers asynchronously (the yaml-language-server boot), while the main
 * thread fires doValidation/getFoldingRanges/... the moment a yaml model
 * opens. Requests losing that race reject INSIDE this worker context as
 * "Missing requestHandler or method: ..." — uncatchable from the window,
 * so the guard is installed HERE, BEFORE the monaco-yaml worker module is
 * imported (static imports hoist — hence the dynamic import).
 */
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
	const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
	if (/Missing requestHandler or method: /.test(reason)) {
		event.preventDefault();
	}
});

import('monaco-yaml/yaml.worker');
