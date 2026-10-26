import type { Page, Suggestion } from "./types.ts";

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

/**
 * How well each page fits a query that's still being typed: the share of its words (stop words
 * aside) the page has, from 0 to 1, best first. Unless the query ends in a space, its last word
 * may be unfinished, so it also counts when it starts a word on the page ("prin" for "printing").
 * Pages with no words in common are left out.
 */
export function scorePages<P extends Page>(query: string, pages: readonly P[]): Suggestion<P>[] {
  const typed = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w));
  if (typed.length === 0) return [];
  const partial = /[\p{L}\p{N}]$/u.test(query);
  return pages
    .map((page, order) => {
      const text = `${page.title} ${page.about}`;
      const stems = new Set(words(text));
      const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const found = typed.filter(
        (w, i) =>
          stems.has(words(w)[0]!) ||
          (partial && i === typed.length - 1 && w.length >= 2 && raw.some((r) => r.startsWith(w))),
      ).length;
      return { page, score: found / typed.length, order };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ page, score }) => ({ page, score }));
}

/** The page sharing the most words with `query`, or undefined when none shares any. */
export function matchPage<P extends Page>(query: string, pages: readonly P[]): P | undefined {
  return rankPages(query, pages)[0];
}
