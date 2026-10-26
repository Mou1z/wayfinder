/** A page someone can be sent to. `about` says what it covers, in the words a visitor might use. */
export type Page = { href: string; title: string; about: string };

/**
 * Where a search goes: the one page that fits, a few that might when the model isn't sure enough
 * (only with a `threshold`), or none, which the host turns into its own fallback.
 */
export type FindResult<P = Page> =
  | { kind: "page"; page: P; confidence?: number }
  | { kind: "unsure"; pages: P[] }
  | { kind: "none" };

/**
 * One question for a provider: which of `options` (name → what it means) fits `state`. Option
 * names are short slugs; one of them is always `none`.
 */
export type Choice = {
  state: Record<string, unknown>;
  instructions: string;
  options: Record<string, string>;
};

/** A provider's answer. `probabilities`, when given, maps option names to how likely each is. */
export type Decision = {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

/** A page offered while someone types, with how well it fits (0 to 1). */
export type Suggestion<P = Page> = { page: P; score: number };

/** All the browser is told about a page. */
export type PageLink = { href: string; title: string };

/** What the endpoint answers a search with (`{ query }`). */
export type SearchResponse = FindResult<PageLink>;

/** What the endpoint answers a request for suggestions with (`{ query, suggest: true }`). */
export type SuggestResponse = { suggestions: Suggestion<PageLink>[] };

/**
 * Something that can pick one option from a fixed list: a decision model, an LLM held to a list of
 * choices, embeddings. It throws (or rejects) on any failure and Wayfinder falls back to word
 * matching; an answer that isn't one of the options is treated the same way, so a provider can't
 * send anyone off the list. It should stop work when `signal` aborts. Its errors go to
 * `onFallback`, which hosts may log, so they must never contain what was searched for.
 */
export interface Provider {
  choose(choice: Choice, context: { signal: AbortSignal }): Promise<Decision>;
  /**
   * Optional, for suggestions: how well each option fits `state`, from 0 to 1, each on its own
   * rather than shared out between them, so several can fit well. `choice.options` has no `none`.
   * Options left out count as 0. Without it, suggestions come from word matching.
   */
  score?(choice: Choice, context: { signal: AbortSignal }): Promise<Record<string, number>>;
}
