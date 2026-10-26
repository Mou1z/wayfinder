// Wayfinder's core, for the server: findPage() and what it's built from. The search box for the
// browser is "wayfinder-search/element".

export { findPage, type FindOptions } from "./find.ts";
export { matchPage, rankPages, scorePages } from "./match.ts";
export { suggestPages, type SuggestOptions } from "./suggest.ts";
export { NONE, optionNames } from "./options.ts";
export {
  DEFAULT_OPENROUTER_MODEL,
  openRouter,
  type OpenRouterOptions,
} from "./providers/openrouter.ts";
export type { Choice, Decision, FindResult, Page, Provider, Suggestion } from "./types.ts";
