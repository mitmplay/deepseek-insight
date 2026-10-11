// Ambient declaration for Svelte's internal client API. It has no published
// type declarations, but tests import effect_root to run compiled runes effects.
declare module "svelte/internal/client" {
  /**
   * Creates an effect scope root. Returns a cleanup function that destroys all
   * effects created inside the scope (matches the runtime signature).
   */
  export function effect_root(fn: () => unknown): () => void;
}
