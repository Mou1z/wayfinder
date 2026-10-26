import { optionNames } from "./options.ts";
import type { Page } from "./types.ts";

// What every search needs from a page list, worked out once per list rather than per search: the
// option names and descriptions a provider sees, and each page's words for matching.

export type Catalog<P extends Page> = {
  names: string[];
  byName: Map<string, P>;
  /** Option name → "Title: about", for providers. */
  descriptions: Record<string, string>;
  words: { title: Set<string>; about: Set<string>; raw: string[] }[];
};

const STOP = new Set(
  "a an and are can do for how i in is it me my of on or the to what with you".split(" "),
);

// Lower-cased words, with no stemming.
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Roughly stemmed, so "died" meets "dies" and "note" meets "notes". */
export const stem = (word: string) =>
  word
    .replace(/i(es|ed)$/, "y")
    .replace(/(?<=\w{3})(ing|ed)$/, "")
    .replace(/(?<!s)s$/, "");

/** The words of a query that say something about which page someone wants. */
export const meaningful = (text: string) => tokens(text).filter((w) => !STOP.has(w));

// Keyed by the list itself. A list changed in place is worked out again if its length changed;
// pass a new array to be sure.
const cache = new WeakMap<readonly Page[], Catalog<Page>>();

export function catalogOf<P extends Page>(pages: readonly P[]): Catalog<P> {
  const cached = cache.get(pages);
  if (cached && cached.names.length === pages.length) return cached as Catalog<P>;
  const names = optionNames(pages);
  const catalog: Catalog<P> = {
    names,
    byName: new Map(pages.map((page, i) => [names[i]!, page])),
    descriptions: Object.fromEntries(pages.map((page, i) => [names[i]!, `${page.title}: ${page.about}`])),
    words: pages.map((page) => ({
      title: new Set(tokens(page.title).map(stem)),
      about: new Set(tokens(page.about).map(stem)),
      raw: [...tokens(page.title), ...tokens(page.about)],
    })),
  };
  cache.set(pages, catalog);
  return catalog;
}
