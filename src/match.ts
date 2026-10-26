import { catalogOf, meaningful, stem } from "./catalog.ts";
import type { Page, Suggestion } from "./types.ts";

// Word matching: what answers when there's no provider, or it fails. Rough, but it needs nothing.

/**
 * The pages sharing any words with `query`, best first: a word in the title counts double, one in
 * `about` counts once. Ties keep the pages' order.
 */
export function rankPages<P extends Page>(query: string, pages: readonly P[]): P[] {
  const wanted = meaningful(query).map(stem);
  if (wanted.length === 0) return [];
  const { words } = catalogOf(pages);
  return pages
    .map((page, i) => {
      const { title, about } = words[i]!;
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

/**
 * How well each page fits a query that's still being typed: the share of its words (stop words
 * aside) the page has, from 0 to 1, best first. Unless the query ends in a space, its last word
 * may be unfinished, so it also counts when it starts a word on the page ("prin" for "printing").
 * Pages with no words in common are left out.
 */
export function scorePages<P extends Page>(query: string, pages: readonly P[]): Suggestion<P>[] {
  const typed = meaningful(query);
  if (typed.length === 0) return [];
  const unfinished = /[\p{L}\p{N}]$/u.test(query) ? typed.length - 1 : -1;
  const { words } = catalogOf(pages);
  return pages
    .map((page, i) => {
      const { title, about, raw } = words[i]!;
      const found = typed.filter((w, at) => {
        const s = stem(w);
        if (title.has(s) || about.has(s)) return true;
        return at === unfinished && w.length >= 2 && raw.some((r) => r.startsWith(w));
      }).length;
      return { page, score: found / typed.length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
