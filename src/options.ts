import type { Page } from "./types.ts";

/** The option meaning no page fits. */
export const NONE = "none";

/**
 * The option each page is to a provider: a readable slug of its title, unique across the list and
 * never `none` ("opening-hours", "opening-hours-2").
 */
export function optionNames(pages: readonly Page[]): string[] {
  const taken = new Set<string>([NONE]);
  return pages.map((page) => {
    const base =
      page.title
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48)
        .replace(/-$/, "") || "page";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  });
}
