import type { Page } from "./types.ts";

// Word matching: what answers when there's no provider, or it fails. Rough, but it needs nothing.

// Lower-cased, and roughly stemmed so "died" meets "dies" and "note" meets "notes".
const words = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) =>
    w
      .replace(/i(es|ed)$/, "y")
      .replace(/(?<=\w{3})(ing|ed)$/, "")
      .replace(/(?<!s)s$/, ""),
  );

// Too common to say anything about which page someone wants.
const STOP = new Set(
  "a an and are can do for how i in is it me my of on or the to what with you".split(" "),
);

/**
 * The pages sharing any words with `query`, best first: a word in the title counts double, one in
 * `about` counts once. Ties keep the pages' order.
 */
export function rankPages<P extends Page>(query: string, pages: readonly P[]): P[] {
  const wanted = words(query).filter((w) => !STOP.has(w));
  return pages
    .map((page) => {
      const title = new Set(words(page.title));
      const about = new Set(words(page.about));
      const score = wanted.reduce(
        (sum, w) => sum + (title.has(w) ? 2 : 0) + (about.has(w) ? 1 : 0),
        0,
      );
      return { page, score };
    })
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((ranked) => ranked.page);
}

/** The page sharing the most words with `query`, or undefined when none shares any. */
export function matchPage<P extends Page>(query: string, pages: readonly P[]): P | undefined {
  return rankPages(query, pages)[0];
}
