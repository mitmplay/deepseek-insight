/**
 * yaml-worker stub — vitest alias for 'monaco-yaml/yaml.worker?worker'
 * (vitest.config.ts). The real worker bundle drags monaco-worker-manager
 * (and Monaco's deep esm paths) into the unit graph; no glue test spawns
 * workers under happy-dom, so a no-op class with the Worker shape is all
 * the default export must offer.
 */
export default class YamlWorkerStub {
	/** no-op worker surface */
	addEventListener(): void {}
	removeEventListener(): void {}
	postMessage(): void {}
	terminate(): void {}
}
