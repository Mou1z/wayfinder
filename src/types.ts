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

/**
 * Something that can pick one option from a fixed list: a decision model, an LLM held to a list of
 * choices, embeddings. It throws (or rejects) on any failure and Wayfinder falls back to word
 * matching; an answer that isn't one of the options is treated the same way, so a provider can't
 * send anyone off the list. It should stop work when `signal` aborts.
 */
export interface Provider {
  choose(choice: Choice, context: { signal: AbortSignal }): Promise<Decision>;
}
