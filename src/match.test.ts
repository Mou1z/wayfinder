import { describe, expect, it } from "vitest";
import { matchPage, rankPages } from "./match.ts";
import { optionNames } from "./options.ts";

const pages = [
  { href: "/join", title: "Join the library", about: "Get a library card, or replace a lost one" },
  { href: "/events/children", title: "Children's events", about: "Story time and craft clubs" },
  { href: "/history", title: "Local history", about: "Old maps, photos and parish records" },
];

describe("optionNames", () => {
  it("names each page readably, uniquely, never as the way out", () => {
    expect(
      optionNames([
        ...pages,
        { href: "/a", title: "Join the library", about: "" },
        { href: "/b", title: "None", about: "" },
        { href: "/c", title: "Café & Crèche", about: "" },
        { href: "/d", title: "???", about: "" },
      ]),
    ).toEqual([
      "join-the-library",
      "children-s-events",
      "local-history",
      "join-the-library-2",
      "none-2",
      "cafe-creche",
      "page",
    ]);
  });

  it("keeps names short", () => {
    const [name] = optionNames([{ href: "/", title: "word ".repeat(30), about: "" }]);
    expect(name!.length).toBeLessThanOrEqual(48);
    expect(name).not.toMatch(/-$/);
  });
});

describe("rankPages and matchPage", () => {
  it("finds the page sharing the most words, titles counting double", () => {
    expect(matchPage("how do I join", pages)?.href).toBe("/join");
    expect(matchPage("I lost my card", pages)?.href).toBe("/join");
    expect(matchPage("old photos of the village", pages)?.href).toBe("/history");
  });

  it("stems roughly, so different forms of a word meet", () => {
    expect(matchPage("crafting for kids", pages)?.href).toBe("/events/children");
    expect(matchPage("a map", pages)?.href).toBe("/history");
  });

  it("ranks every page that shares a word, best first", () => {
    expect(rankPages("library history", pages).map((p) => p.href)).toEqual(["/join", "/history"]);
  });

  it("finds nothing when no word is shared, or only stop words are", () => {
    expect(matchPage("mortgage broker", pages)).toBeUndefined();
    expect(rankPages("how do I", pages)).toEqual([]);
  });
});
