// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearch } from "./client.ts";

const fetchMock = vi.fn();
const navigate = vi.fn();
const hours = { href: "/hours", title: "Opening hours" };
const absolute = (href: string) => new URL(href, location.href).href;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  navigate.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const suggestions = (...titles: string[]) =>
  Response.json({
    suggestions: titles.map((title) => ({ page: { href: `/${title}`, title }, score: 0.9 })),
  });
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body);

describe("createSearch: searching", () => {
  it("posts the query and goes to the page", async () => {
    fetchMock.mockResolvedValue(Response.json({ kind: "page", page: hours }));
    const search = createSearch({ endpoint: "/api/search", navigate });
    await search.submit("  when are you open ");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/search");
    expect(sent(0)).toEqual({ query: "when are you open" });
    expect(navigate).toHaveBeenCalledWith({ href: absolute("/hours"), title: "Opening hours" });
    expect(search.state.status).toBe("idle");
  });

  it("shows none, unsure and error until the visitor types again", async () => {
    const search = createSearch({ endpoint: "/api/search", navigate });
    const seen: string[] = [];
    search.subscribe((state) => seen.push(state.status));

    fetchMock.mockResolvedValue(Response.json({ kind: "none" }));
    await search.submit("parking");
    expect(search.state.status).toBe("none");

    fetchMock.mockResolvedValue(Response.json({ kind: "unsure", pages: [hours] }));
    await search.submit("open?");
    expect(search.state).toMatchObject({ status: "unsure", pages: [{ title: "Opening hours" }] });

    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await search.submit("hours");
    expect(search.state.status).toBe("error");

    search.type("hours!");
    expect(search.state.status).toBe("idle");
    expect(seen).toEqual(["searching", "none", "searching", "unsure", "searching", "error", "idle"]);
  });

  it("never follows a link that isn't http(s)", async () => {
    fetchMock.mockResolvedValue(Response.json({ kind: "page", page: { href: "javascript:alert(1)", title: "x" } }));
    const search = createSearch({ endpoint: "/api/search", navigate });
    await search.submit("hours");
    expect(navigate).not.toHaveBeenCalled();
    expect(search.state.status).toBe("error");
  });
});

describe("createSearch: suggestions", () => {
  it("waits for a pause in typing, then asks", async () => {
    fetchMock.mockResolvedValue(suggestions("Opening hours"));
    const search = createSearch({ endpoint: "/api/search", suggest: true });
    search.type("op");
    search.type("ope");
    search.type("open");
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sent(0)).toEqual({ query: "open", suggest: true });
    expect(search.state.suggestions.map((s) => s.page.title)).toEqual(["Opening hours"]);
  });

  it("keeps the cooldown between requests", async () => {
    fetchMock.mockImplementation(async () => suggestions("x"));
    const search = createSearch({ endpoint: "/api/search", suggest: true, cooldownMs: 1000 });
    search.type("open");
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    search.type("opening");
    await vi.advanceTimersByTimeAsync(999); // The last request went at 300, so the next waits until 1300.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1).query).toBe("opening");
  });

  it("doesn't ask again for what it already knows", async () => {
    fetchMock.mockImplementation(async () => suggestions("x"));
    const search = createSearch({ endpoint: "/api/search", suggest: true, cooldownMs: 0 });
    search.type("open");
    await vi.advanceTimersByTimeAsync(300);
    search.type("opens");
    await vi.advanceTimersByTimeAsync(300);
    search.type("open");
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(search.state.suggestions).toHaveLength(1);
  });

  it("asks for nothing until minLength, or with suggestions off", async () => {
    const off = createSearch({ endpoint: "/api/search" });
    off.type("opening hours");
    const short = createSearch({ endpoint: "/api/search", suggest: true, minLength: 4 });
    short.type("ope");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops suggestions when the text gets too short, a search starts, or on dismiss", async () => {
    fetchMock.mockResolvedValue(suggestions("x"));
    const search = createSearch({ endpoint: "/api/search", suggest: true, cooldownMs: 0 });
    search.type("open");
    await vi.advanceTimersByTimeAsync(300);
    expect(search.state.suggestions).toHaveLength(1);
    search.type("op");
    expect(search.state.suggestions).toEqual([]);

    search.type("open");
    expect(search.state.suggestions).toHaveLength(1);
    search.dismiss();
    expect(search.state.suggestions).toEqual([]);

    search.type("open");
    fetchMock.mockResolvedValue(Response.json({ kind: "none" }));
    await search.submit("open");
    expect(search.state.suggestions).toEqual([]);
  });

  it("goes to a suggestion", async () => {
    fetchMock.mockResolvedValue(suggestions("x"));
    const search = createSearch({ endpoint: "/api/search", suggest: true, navigate });
    search.type("open");
    await vi.advanceTimersByTimeAsync(300);
    search.go(search.state.suggestions[0]!.page);
    expect(navigate).toHaveBeenCalledWith({ href: absolute("/x"), title: "x" });
    expect(search.state.suggestions).toEqual([]);
  });
});
