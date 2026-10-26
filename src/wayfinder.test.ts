import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "./types.ts";
import { createWayfinder } from "./wayfinder.ts";

const pages = [
  { href: "/join", title: "Join the library", about: "Get a library card, or replace a lost one", secret: 1 },
  { href: "/hours", title: "Opening hours", about: "When each branch is open, and holidays", secret: 2 },
];

const post = (body: unknown, type = "application/json") =>
  new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => vi.unstubAllGlobals());

describe("createWayfinder", () => {
  it("answers a search with the page, telling the browser only its href and title", async () => {
    const response = await createWayfinder({ pages }).handle(post({ query: "I lost my card" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      kind: "page",
      page: { href: "/join", title: "Join the library" },
    });
  });

  it("answers a request for suggestions with scored pages", async () => {
    const response = await createWayfinder({ pages }).handle(post({ query: "opening ho", suggest: true }));
    expect(await response.json()).toEqual({
      suggestions: [{ page: { href: "/hours", title: "Opening hours" }, score: 1 }],
    });
  });

  it("answers suggestions with none when they're turned off", async () => {
    const wayfinder = createWayfinder({ pages, suggestions: false });
    expect((await wayfinder.answer({ query: "hours", suggest: true })).body).toEqual({ suggestions: [] });
  });

  it("passes its settings on to the provider", async () => {
    const choose = vi.fn<Provider["choose"]>(async () => ({ choice: "opening-hours", confidence: 0.4 }));
    const score = vi.fn<NonNullable<Provider["score"]>>(async () => ({ "opening-hours": 0.6 }));
    const wayfinder = createWayfinder({
      pages,
      provider: { choose, score },
      site: "Fernhollow",
      threshold: 0.5,
      suggestions: { minScore: 0.5 },
    });
    expect((await wayfinder.answer({ query: "when are you open" })).body).toEqual({
      kind: "unsure",
      pages: [{ href: "/hours", title: "Opening hours" }],
    });
    expect(choose.mock.calls[0]![0].state).toEqual({ site: "Fernhollow", visitor_search: "when are you open" });
    expect((await wayfinder.answer({ query: "open", suggest: true })).body).toEqual({
      suggestions: [{ page: { href: "/hours", title: "Opening hours" }, score: 0.6 }],
    });
  });

  it("uses OpenRouter when given an API key", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ answers: { page: { choice: "opening-hours", confidence: 0.9 } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const wayfinder = createWayfinder({ pages, apiKey: "sk-or-test" });
    expect(await wayfinder.find("when are you open")).toMatchObject({ kind: "page", confidence: 0.9 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("turns away what isn't a search", async () => {
    const { handle } = createWayfinder({ pages });
    expect((await handle(new Request("http://localhost/api/search"))).status).toBe(405);
    expect((await handle(post("not json"))).status).toBe(400);
    expect((await handle(post({ query: "  " }))).status).toBe(400);
    expect((await handle(post({ query: 3 }))).status).toBe(400);
    expect((await handle(post({ query: "a".repeat(1001) }))).status).toBe(400);
    expect((await handle(post({ query: "x".repeat(5000) }))).status).toBe(413);
    expect((await handle(post({ query: "hours" }, "text/plain"))).status).toBe(415);
  });

  it("stops reading a body as soon as it's too large, whatever its length says", async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024;
        controller.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    const request = new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: endless,
      duplex: "half",
    } as RequestInit);
    expect((await createWayfinder({ pages }).handle(request)).status).toBe(413);
    expect(sent).toBeLessThan(10_000);
  });

  it("keeps its own copy of the pages", async () => {
    const list = [...pages];
    const wayfinder = createWayfinder({ pages: list });
    list.push({ href: "/print", title: "Printing", about: "Print and scan", secret: 3 });
    expect(await wayfinder.find("printing")).toEqual({ kind: "none" });
    expect(await wayfinder.find("opening hours")).toMatchObject({ kind: "page", page: { href: "/hours" } });
  });

  it("serves Node and Express requests, read or already parsed", async () => {
    const { node } = createWayfinder({ pages });
    const respond = () => {
      const response = {
        statusCode: 0,
        headers: {} as Record<string, string>,
        body: "",
        setHeader(name: string, value: string) {
          this.headers[name] = value;
        },
        end(body: string) {
          this.body = body;
        },
        on: vi.fn(),
      };
      return response;
    };
    const streamed = Object.assign(
      (async function* () {
        yield new TextEncoder().encode('{"query":"lost');
        yield ' card"}';
      })(),
      { method: "POST", headers: { "content-type": "application/json; charset=utf-8" } },
    );
    const first = respond();
    await node(streamed, first);
    expect(first.statusCode).toBe(200);
    expect(first.headers["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(first.body)).toMatchObject({ kind: "page", page: { href: "/join" } });

    const parsed = Object.assign((async function* () {})(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { query: "opening hours" },
    });
    const second = respond();
    await node(parsed, second);
    expect(JSON.parse(second.body)).toMatchObject({ kind: "page", page: { href: "/hours" } });
  });
});
