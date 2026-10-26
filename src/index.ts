// Wayfinder for the server. Most sites need only createWayfinder(); the rest is what it's built
// from. In the browser, use "wayfinder-search/element" (the ready-made search box) or
// "wayfinder-search/client" (to build your own).

export {
  createWayfinder,
  type NodeRequest,
  type NodeResponse,
  type Wayfinder,
  type WayfinderOptions,
} from "./wayfinder.ts";
export { findPage, type FindOptions } from "./find.ts";
export { suggestPages, type SuggestOptions } from "./suggest.ts";
export { matchPage, rankPages, scorePages } from "./match.ts";
export { NONE, optionNames } from "./options.ts";
export {
  DEFAULT_OPENROUTER_MODEL,
  openRouter,
  type OpenRouterOptions,
} from "./providers/openrouter.ts";
export type {
  Choice,
  Decision,
  FindResult,
  Page,
  PageLink,
  Provider,
  SearchResponse,
  Suggestion,
  SuggestResponse,
} from "./types.ts";
