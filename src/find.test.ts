import { describe, expect, it, vi } from "vitest";
import { findPage } from "./find.ts";
import type { Choice, Decision, Provider } from "./types.ts";

const pages = [
  { href: "/join", title: "Join the library", about: "Get a library card, or replace a lost one" },
  { href: "/hours", title: "Opening hours", about: "When each branch is open, and holidays" },
  { href: "/events/children", title: "Children's events", about: "Story time and craft clubs" },
  { href: "/history", title: "Local history", about: "Old maps, photos and parish records" },
];

// A provider that answers `decision`, recording what it was asked.
const answering = (decision: Decision) => {
  const choose = vi.fn(async (_choice: Choice, _context: { signal: AbortSignal }) => decision);
  return { provider: { choose } satisfies Provider, choose };
};
const failing = (error: unknown): Provider => ({ choose: async () => Promise.reject(error) });

describe("findPage without a provider", () => {
  it("matches words", async () => {
    expect(await findPage("I lost my card", pages)).toEqual({ kind: "page", page: pages[0] });
    expect(await findPage("parking permits", pages)).toEqual({ kind: "none" });
  });

  it("is none for an empty query or no pages", async () => {
    expect(await findPage("   ", pages)).toEqual({ kind: "none" });
    expect(await findPage("hours", [])).toEqual({ kind: "none" });
  });
});

describe("findPage with a provider", () => {
  it("asks it to choose among the pages, or none", async () => {
    const { provider, choose } = answering({ choice: "children-s-events", confidence: 0.9 });
    const result = await findPage("my kid is bored on saturday", pages, {
      provider,
      site: "Fernhollow Library",
    });
    expect(result).toEqual({ kind: "page", page: pages[2], confidence: 0.9 });
    const [choice] = choose.mock.calls[0]!;
    expect(choice.state).toEqual({
      site: "Fernhollow Library",
      visitor_search: "my kid is bored on saturday",
    });
    expect(choice.instructions).toContain("Fernhollow Library");
    expect(Object.keys(choice.options)).toEqual([
      "join-the-library",
      "opening-hours",
      "children-s-events",
      "local-history",
      "none",
    ]);
    expect(choice.options["opening-hours"]).toBe(
      "Opening hours: When each branch is open, and holidays",
    );
  });

  it("is none when the provider says so", async () => {
    const { provider } = answering({ choice: "none", confidence: 0.95 });
    expect(await findPage("parking permits", pages, { provider })).toEqual({ kind: "none" });
  });

  it("trims and shortens the query before sending it", async () => {
    const { provider, choose } = answering({ choice: "none" });
    await findPage(`  ${"a".repeat(300)}  `, pages, { provider, maxQueryLength: 50 });
    expect(choose.mock.calls[0]![0].state).toEqual({ visitor_search: "a".repeat(50) });
  });

  it("lets the instructions and the meaning of none be replaced", async () => {
    const { provider, choose } = answering({ choice: "none" });
    await findPage("hi", pages, { provider, instructions: "Pick one.", noneMeans: "Call us" });
    const [choice] = choose.mock.calls[0]!;
    expect(choice.instructions).toBe("Pick one.");
    expect(choice.options.none).toBe("Call us");
  });
});

describe("findPage falling back to word matching", () => {
  it("does when the provider fails, telling onFallback why", async () => {
    const onFallback = vi.fn();
    const error = new Error("OpenRouter answered 402");
    expect(
      await findPage("opening hours", pages, { provider: failing(error), onFallback }),
    ).toEqual({ kind: "page", page: pages[1] });
    expect(onFallback).toHaveBeenCalledWith(error);
  });

  it("does when the provider throws before it even starts", async () => {
    const provider: Provider = {
      choose: () => {
        throw new Error("boom");
      },
    };
    expect(await findPage("opening hours", pages, { provider })).toEqual({
      kind: "page",
      page: pages[1],
    });
  });

  it("does when the provider answers with something that isn't an option", async () => {
    const onFallback = vi.fn();
    const { provider } = answering({ choice: "https://evil.example", confidence: 1 });
    expect(await findPage("old maps", pages, { provider, onFallback })).toEqual({
      kind: "page",
      page: pages[3],
    });
    expect(onFallback.mock.calls[0]![0].message).toMatch(/isn't one of the options/);
  });

  it("does when the provider runs out of time, aborting its signal", async () => {
    let seen: AbortSignal | undefined;
    const provider: Provider = {
      choose: (_choice, { signal }) => {
        seen = signal;
        return new Promise(() => {}); // Never answers, and ignores the signal.
      },
    };
    const onFallback = vi.fn();
    expect(
      await findPage("opening hours", pages, { provider, timeoutMs: 20, onFallback }),
    ).toEqual({ kind: "page", page: pages[1] });
    expect(seen?.aborted).toBe(true);
    expect(onFallback.mock.calls[0]![0].name).toBe("TimeoutError");
  });

  it("never puts the query in what it reports", async () => {
    const onFallback = vi.fn();
    const { provider } = answering({ choice: "made-up" });
    await findPage("my secret address", pages, { provider, onFallback });
    expect(String(onFallback.mock.calls[0]![0])).not.toContain("secret");
  });

  it("rejects instead when the caller aborts", async () => {
    const controller = new AbortController();
    const provider: Provider = { choose: () => new Promise(() => {}) };
    const found = findPage("hours", pages, { provider, signal: controller.signal });
    controller.abort(new Error("client went away"));
    await expect(found).rejects.toThrow("client went away");
  });
});

describe("findPage with a threshold", () => {
  it("stands by an answer at or above it", async () => {
    const { provider } = answering({ choice: "opening-hours", confidence: 0.7 });
    expect(await findPage("when are you open", pages, { provider, threshold: 0.7 })).toEqual({
      kind: "page",
      page: pages[1],
      confidence: 0.7,
    });
  });

  it("below it, offers the likeliest pages by the provider's probabilities", async () => {
    const { provider } = answering({
      choice: "children-s-events",
      confidence: 0.4,
      probabilities: {
        "children-s-events": 0.4,
        "local-history": 0.35,
        "join-the-library": 0.2,
        "opening-hours": 0.01,
        none: 0.04,
      },
    });
    expect(
      await findPage("something for a school project", pages, {
        provider,
        threshold: 0.6,
        unsureLimit: 2,
      }),
    ).toEqual({ kind: "unsure", pages: [pages[2], pages[3]] });
  });

  it("below it without probabilities, offers its pick then the best word matches", async () => {
    const { provider } = answering({ choice: "local-history", confidence: 0.3 });
    expect(await findPage("library card", pages, { provider, threshold: 0.5 })).toEqual({
      kind: "unsure",
      pages: [pages[3], pages[0]],
    });
  });

  it("reads confidence from the probabilities when none is given", async () => {
    const { provider } = answering({
      choice: "opening-hours",
      probabilities: { "opening-hours": 0.3, "join-the-library": 0.3 },
    });
    expect(await findPage("hours", pages, { provider, threshold: 0.5 })).toEqual({
      kind: "unsure",
      pages: [pages[1], pages[0]],
    });
  });

  it("is none when an unsure none leaves no likely page", async () => {
    const { provider } = answering({ choice: "none", confidence: 0.4 });
    expect(await findPage("parking permits", pages, { provider, threshold: 0.6 })).toEqual({
      kind: "none",
    });
  });

  it("doesn't apply without a confidence", async () => {
    const { provider } = answering({ choice: "opening-hours" });
    expect(await findPage("hours", pages, { provider, threshold: 0.9 })).toEqual({
      kind: "page",
      page: pages[1],
    });
  });
});
