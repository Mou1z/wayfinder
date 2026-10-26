import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Choice } from "../types.ts";
import { openRouter } from "./openrouter.ts";

const fetchMock = vi.fn();
const choice: Choice = {
  state: { visitor_search: "my kid is bored" },
  instructions: "Which page?",
  options: { "children-s-events": "Story time and craft clubs", none: "Nothing fits" },
};
const signal = new AbortController().signal;
const answer = (page: unknown, status = 200) =>
  new Response(JSON.stringify({ answers: { page } }), { status });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("openRouter", () => {
  it("asks the Decisions API one choice question, keeping providers from storing it", async () => {
    fetchMock.mockResolvedValue(
      answer({
        type: "choice",
        choice: "children-s-events",
        confidence: 0.8,
        probabilities: { "children-s-events": 0.9, none: 0.1 },
      }),
    );
    const provider = openRouter({ apiKey: "sk-or-test" });
    expect(await provider.choose(choice, { signal })).toEqual({
      choice: "children-s-events",
      confidence: 0.8,
      probabilities: { "children-s-events": 0.9, none: 0.1 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body)).toEqual({
      model: "typesafe/jev-1.14",
      state: choice.state,
      questions: {
        page: { type: "choice", instructions: "Which page?", criteria: choice.options },
      },
      provider: { data_collection: "deny" },
    });
  });

  it("uses the model it's given", async () => {
    fetchMock.mockResolvedValue(answer({ choice: "none" }));
    await openRouter({ apiKey: "sk-or-test", model: "acme/decider-2" }).choose(choice, { signal });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe("acme/decider-2");
  });

  it("leaves out confidence and probabilities that aren't numbers", async () => {
    fetchMock.mockResolvedValue(
      answer({ choice: "none", confidence: "high", probabilities: { none: 1, x: "?" } }),
    );
    expect(await openRouter({ apiKey: "k" }).choose(choice, { signal })).toEqual({
      choice: "none",
      probabilities: { none: 1 },
    });
  });

  it("throws on an error status, a malformed answer, or a failed request", async () => {
    const provider = openRouter({ apiKey: "k" });
    fetchMock.mockResolvedValue(answer({}, 402));
    await expect(provider.choose(choice, { signal })).rejects.toThrow("OpenRouter answered 402");
    fetchMock.mockResolvedValue(answer({ choice: 3 }));
    await expect(provider.choose(choice, { signal })).rejects.toThrow("wasn't a choice");
    fetchMock.mockResolvedValue(new Response("not json"));
    await expect(provider.choose(choice, { signal })).rejects.toThrow();
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(provider.choose(choice, { signal })).rejects.toThrow("offline");
  });

  it("scores each option with its own yes-or-no question, in one request", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: { page_0: { type: "noul", noul: 0.91 }, page_1: { type: "noul", noul: "?" } },
        }),
      ),
    );
    const options = { "children-s-events": "Story time and craft clubs", "local-history": "Old maps" };
    expect(
      await openRouter({ apiKey: "k" }).score!({ ...choice, options }, { signal }),
    ).toEqual({ "children-s-events": 0.91 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.provider).toEqual({ data_collection: "deny" });
    expect(body.questions).toEqual({
      page_0: {
        type: "noul",
        instructions: "Which page?",
        criteria: {
          true: "This page answers it. Story time and craft clubs",
          false: "This page doesn't answer what they're looking for",
        },
      },
      page_1: {
        type: "noul",
        instructions: "Which page?",
        criteria: {
          true: "This page answers it. Old maps",
          false: "This page doesn't answer what they're looking for",
        },
      },
    });
  });

  it("throws when scoring gets an error status or no scores", async () => {
    const provider = openRouter({ apiKey: "k" });
    fetchMock.mockResolvedValue(answer({}, 429));
    await expect(provider.score!(choice, { signal })).rejects.toThrow("OpenRouter answered 429");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ answers: {} })));
    await expect(provider.score!(choice, { signal })).rejects.toThrow("no scores");
  });

  it("can't be created without a key, or in a browser", () => {
    expect(() => openRouter({ apiKey: "" })).toThrow("needs an apiKey");
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    expect(() => openRouter({ apiKey: "k" })).toThrow("server only");
  });
});
