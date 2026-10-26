import { describe, expect, it, vi } from "vitest";
import { scorePages } from "./match.ts";
import { suggestPages } from "./suggest.ts";
import type { Choice, Provider } from "./types.ts";

const pages = [
  { href: "/join", title: "Join the library", about: "Get a library card, or replace a lost one" },
  { href: "/hours", title: "Opening hours", about: "When each branch is open, and holidays" },
  { href: "/study", title: "Study rooms", about: "Computers, printing and scanning" },
  { href: "/history", title: "Local history", about: "Old maps, photos and parish records" },
];

// A provider that scores pages with `scores`, recording what it was asked.
const scoring = (scores: Record<string, number>) => {
  const score = vi.fn(async (_choice: Choice, _context: { signal: AbortSignal }) => scores);
  const provider: Provider = { choose: async () => ({ choice: "none" }), score };
  return { provider, score };
};

describe("scorePages", () => {
  it("scores pages by the share of the query's words they have", () => {
    expect(scorePages("lost library card", pages)).toEqual([{ page: pages[0], score: 1 }]);
    expect(scorePages("lost photos ", pages)).toEqual([
      { page: pages[0], score: 0.5 },
      { page: pages[3], score: 0.5 },
    ]);
  });

  it("counts an unfinished last word that starts a word on the page", () => {
    expect(scorePages("prin", pages)).toEqual([{ page: pages[2], score: 1 }]);
    expect(scorePages("prin ", pages)).toEqual([]);
    expect(scorePages("p", pages)).toEqual([]);
  });

  it("ignores stop words", () => {
    expect(scorePages("how do I", pages)).toEqual([]);
    expect(scorePages("how do I join", pages)).toEqual([{ page: pages[0], score: 1 }]);
  });
});

describe("suggestPages without a provider", () => {
  it("suggests the pages scoring at least 0.7 by their words", async () => {
    expect(await suggestPages("opening hou", pages)).toEqual([{ page: pages[1], score: 1 }]);
    expect(await suggestPages("lost photos", pages)).toEqual([]);
    expect(await suggestPages("lost photos", pages, { minScore: 0.5 })).toHaveLength(2);
  });

  it("is empty for an empty query or no pages", async () => {
    expect(await suggestPages("  ", pages)).toEqual([]);
    expect(await suggestPages("hours", [])).toEqual([]);
  });

  it("uses word matching with a provider that can't score", async () => {
    const provider: Provider = { choose: vi.fn() };
    expect(await suggestPages("study", pages, { provider })).toEqual([
      { page: pages[2], score: 1 },
    ]);
    expect(provider.choose).not.toHaveBeenCalled();
  });
});

describe("suggestPages with a provider", () => {
  it("asks it to score every page, and keeps the ones at or above minScore, best first", async () => {
    const { provider, score } = scoring({
      "join-the-library": 0.2,
      "opening-hours": 0.7,
      "study-rooms": 0.95,
      "local-history": 0.69,
    });
    expect(
      await suggestPages("somewhere to work on my laptop", pages, { provider, site: "Fernhollow" }),
    ).toEqual([
      { page: pages[2], score: 0.95 },
      { page: pages[1], score: 0.7 },
    ]);
    const [choice] = score.mock.calls[0]!;
    expect(choice.state).toEqual({ site: "Fernhollow", visitor_search: "somewhere to work on my laptop" });
    expect(choice.instructions).toContain("may not have finished");
    expect(Object.keys(choice.options)).toEqual([
      "join-the-library",
      "opening-hours",
      "study-rooms",
      "local-history",
    ]);
  });

  it("keeps to the limit and minScore it's given, and counts missing or odd scores as 0", async () => {
    const { provider } = scoring({
      "join-the-library": 0.9,
      "opening-hours": Number.NaN,
      "study-rooms": 2,
    });
    expect(await suggestPages("x", pages, { provider, limit: 1 })).toEqual([
      { page: pages[2], score: 1 },
    ]);
    expect(await suggestPages("x", pages, { provider, minScore: 0 })).toHaveLength(4);
  });

  it("falls back to word matching when the provider fails or runs out of time", async () => {
    const onFallback = vi.fn();
    const failing: Provider = {
      choose: vi.fn(),
      score: async () => Promise.reject(new Error("OpenRouter answered 429")),
    };
    expect(await suggestPages("opening hours", pages, { provider: failing, onFallback })).toEqual([
      { page: pages[1], score: 1 },
    ]);
    expect(onFallback.mock.calls[0]![0].message).toBe("OpenRouter answered 429");

    const slow: Provider = { choose: vi.fn(), score: () => new Promise(() => {}) };
    expect(await suggestPages("opening hours", pages, { provider: slow, timeoutMs: 20 })).toEqual([
      { page: pages[1], score: 1 },
    ]);
  });

  it("rejects instead when the caller aborts", async () => {
    const controller = new AbortController();
    const slow: Provider = { choose: vi.fn(), score: () => new Promise(() => {}) };
    const suggested = suggestPages("hours", pages, { provider: slow, signal: controller.signal });
    controller.abort(new Error("client went away"));
    await expect(suggested).rejects.toThrow("client went away");
  });
});
