/**
 * Test stub for $app/state (SvelteKit module only present at runtime under
 * the kit dev/prod server). Minimal reactive page object for components that
 * read url/error/status. Mutable global so tests can point it at scenarios.
 */
import { reactiveTestPage } from './app-state-shared.svelte';

export const page = reactiveTestPage;
