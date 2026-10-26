import { withDeadline } from "./deadline.ts";
import { rankPages } from "./match.ts";
import { NONE, optionNames } from "./options.ts";
import type { Choice, Decision, FindResult, Page, Provider } from "./types.ts";

export type FindOptions = {
  /** What picks the page. Without one, word matching answers. */
  provider?: Provider;
  /** How long the provider has before word matching answers instead. Default 6000. */
  timeoutMs?: number;
  /**
   * The confidence (0 to 1) a provider's answer needs to stand. Below it, the result is
   * `unsure` with a few likely pages. Only applies when the provider reports a confidence.
   */
  threshold?: number;
  /** How many pages an `unsure` result offers at most. Default 3. */
  unsureLimit?: number;
  /** The site's name, for the provider ("Fernhollow Library, a public library in Fernhollow"). */
  site?: string;
  /** The question the provider is asked, replacing the default. */
  instructions?: string;
  /** What the `none` option means to the provider, replacing the default. */
  noneMeans?: string;
  /** Longer queries are cut to this many characters. Default 200. */
  maxQueryLength?: number;
  /** Aborting it abandons the search: `findPage` rejects with its reason. */
  signal?: AbortSignal;
  /**
   * Called when the provider fails, times out or answers off the list, just before word matching
   * answers instead. The error never contains the query. Nothing is logged unless you log it.
   */
  onFallback?: (error: unknown) => void;
};

const DEFAULT_NONE =
  "No page on the site helps with this: the site doesn't cover it, or it needs a person to talk it through";

// In an unsure result, pages the provider gives less than this are left out: they're noise.
const MIN_CANDIDATE = 0.05;

/**
 * The one page in `pages` that best fits what someone typed, or `none`. A provider chooses among
 * the pages and can answer with nothing else, so what's typed can't steer it off the site; without
 * one, or when it fails or runs out of time, the words are matched instead.
 *
 * Server-side only: the provider holds an API key. Nothing about the query is stored or logged.
 */
export async function findPage<P extends Page>(
  query: string,
  pages: readonly P[],
  options: FindOptions = {},
): Promise<FindResult<P>> {
  const { provider, threshold, unsureLimit = 3, maxQueryLength = 200 } = options;
  const wanted = query.trim().slice(0, maxQueryLength);
  if (!wanted || pages.length === 0) return { kind: "none" };
  const byWords = (): FindResult<P> => {
    const best = rankPages(wanted, pages)[0];
    return best ? { kind: "page", page: best } : { kind: "none" };
  };
  if (!provider) return byWords();

  const names = optionNames(pages);
  const named = new Map(pages.map((page, i) => [names[i]!, page]));
  const choice: Choice = {
    state: options.site ? { site: options.site, visitor_search: wanted } : { visitor_search: wanted },
    instructions:
      options.instructions ??
      `A visitor typed this into the search box of ${options.site ?? "a website"}. Which page of the site best answers what they are looking for?`,
    options: Object.fromEntries([
      ...pages.map((page, i) => [names[i]!, `${page.title}: ${page.about}`]),
      [NONE, options.noneMeans ?? DEFAULT_NONE],
    ]),
  };

  let decision: Decision;
  try {
    decision = await withDeadline(
      (signal) => provider.choose(choice, { signal }),
      options.timeoutMs ?? 6000,
      options.signal,
    );
    if (decision.choice !== NONE && !named.has(decision.choice))
      throw new Error("The provider answered with something that isn't one of the options");
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    options.onFallback?.(error);
    return byWords();
  }

  const page = named.get(decision.choice);
  const confidence = decision.confidence ?? decision.probabilities?.[decision.choice];
  if (threshold === undefined || confidence === undefined || confidence >= threshold) {
    if (!page) return { kind: "none" };
    return confidence === undefined ? { kind: "page", page } : { kind: "page", page, confidence };
  }

  // Not sure enough: the likeliest pages by the provider's own odds when it gave them, otherwise
  // its pick followed by the best word matches.
  const { probabilities } = decision;
  const likely = probabilities
    ? [...named]
        .map(([name, page]) => ({ page, p: probabilities[name] ?? 0 }))
        .filter(({ p }) => p >= MIN_CANDIDATE)
        .sort((a, b) => b.p - a.p || Number(b.page === page) - Number(a.page === page))
        .map(({ page }) => page)
    : [...new Set([...(page ? [page] : []), ...rankPages(wanted, pages)])];
  const offered = likely.slice(0, unsureLimit);
  return offered.length > 0 ? { kind: "unsure", pages: offered } : { kind: "none" };
}
