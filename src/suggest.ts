import { withDeadline } from "./deadline.ts";
import { scorePages } from "./match.ts";
import { optionNames } from "./options.ts";
import type { Choice, Page, Provider, Suggestion } from "./types.ts";

export type SuggestOptions = {
  /** What scores the pages. Without one, or without `score`, word matching does. */
  provider?: Provider;
  /** The score (0 to 1) a page needs to be suggested. Default 0.7. */
  minScore?: number;
  /** How many pages to suggest at most. Default 5. */
  limit?: number;
  /** How long the provider has before word matching answers instead. Default 3000. */
  timeoutMs?: number;
  /** The site's name, for the provider. */
  site?: string;
  /** The question the provider is asked about each page, replacing the default. */
  instructions?: string;
  /** Longer queries are cut to this many characters. Default 200. */
  maxQueryLength?: number;
  /** Aborting it abandons the suggestions: `suggestPages` rejects with its reason. */
  signal?: AbortSignal;
  /** Called when the provider fails or times out, before word matching answers instead. */
  onFallback?: (error: unknown) => void;
};

/**
 * The pages that fit what someone is typing, best first, each scored 0 to 1 on its own: the ones
 * scoring `minScore` or more, for a dropdown under the search box. A provider that can `score`
 * rates the pages; without one, or when it fails, the words are matched instead.
 *
 * Each call with a provider is a request to it, so call this sparingly: the search box waits for a
 * pause in typing and keeps a cooldown between requests. Server-side only, like `findPage`.
 */
export async function suggestPages<P extends Page>(
  query: string,
  pages: readonly P[],
  options: SuggestOptions = {},
): Promise<Suggestion<P>[]> {
  const { provider, minScore = 0.7, limit = 5, maxQueryLength = 200 } = options;
  const wanted = query.slice(0, maxQueryLength).trimStart();
  if (!wanted.trim() || pages.length === 0) return [];
  const best = (scored: Suggestion<P>[]) =>
    scored.filter((s) => s.score >= minScore).slice(0, limit);
  if (!provider?.score) return best(scorePages(wanted, pages));

  const names = optionNames(pages);
  const choice: Choice = {
    state: options.site
      ? { site: options.site, visitor_search: wanted.trim() }
      : { visitor_search: wanted.trim() },
    instructions:
      options.instructions ??
      `A visitor is typing this into the search box of ${options.site ?? "a website"}, and may not have finished. Would this page of the site answer what they are looking for?`,
    options: Object.fromEntries(pages.map((page, i) => [names[i]!, `${page.title}: ${page.about}`])),
  };

  let scores: Record<string, number>;
  try {
    const score = provider.score.bind(provider);
    scores = await withDeadline(
      (signal) => score(choice, { signal }),
      options.timeoutMs ?? 3000,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    options.onFallback?.(error);
    return best(scorePages(wanted, pages));
  }

  return best(
    pages
      .map((page, i) => ({ page, score: clamp(scores[names[i]!] ?? 0), order: i }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(({ page, score }) => ({ page, score })),
  );
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
