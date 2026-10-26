// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./element.ts";

const fetchMock = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  assign.mockReset();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  document.body.innerHTML = `
    <wayfinder-search endpoint="/api/search" label="Search the library">
      <p slot="none">Ask a librarian</p>
    </wayfinder-search>`;
});
afterEach(() => vi.unstubAllGlobals());

const element = () => document.querySelector("wayfinder-search")!;
const shadow = () => element().shadowRoot!;
const input = () => shadow().querySelector("input")!;
const panel = () => shadow().querySelector<HTMLElement>('[part="panel"]')!;
const respond = (body: unknown) => fetchMock.mockResolvedValue(Response.json(body));

async function search(query: string) {
  input().value = query;
  shadow().querySelector("form")!.requestSubmit();
  await vi.waitFor(() => expect(shadow().querySelector("form")!.getAttribute("aria-busy")).toBe("false"));
}

describe("<wayfinder-search>", () => {
  it("is a labelled search form", () => {
    const form = shadow().querySelector("form")!;
    expect(form.getAttribute("role")).toBe("search");
    const label = shadow().querySelector("label")!;
    expect(label.textContent).toBe("Search the library");
    expect(label.htmlFor).toBe(input().id);
  });

  it("posts the query to its endpoint and goes to the page", async () => {
    respond({ kind: "page", page: { href: "/hours", title: "Opening hours" } });
    await search("  when are you open  ");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/search");
    expect(JSON.parse(init.body)).toEqual({ query: "when are you open" });
    expect(assign).toHaveBeenCalledWith(new URL("/hours", location.href).href);
    expect(input().value).toBe("");
  });

  it("lets the host route instead by cancelling wayfinder-result", async () => {
    respond({ kind: "page", page: { href: "/hours", title: "Opening hours" } });
    const seen = vi.fn((event: Event) => event.preventDefault());
    element().addEventListener("wayfinder-result", seen);
    await search("hours");
    expect(seen.mock.calls[0]![0]).toMatchObject({ detail: { kind: "page" } });
    expect(assign).not.toHaveBeenCalled();
  });

  it("says when nothing fits, showing the host's own fallback", async () => {
    respond({ kind: "none" });
    await search("parking permits");
    expect(panel().hidden).toBe(false);
    expect(panel().textContent).toContain("Nothing on the site fits that.");
    expect(panel().querySelector("slot")!.name).toBe("none");
    expect(input().getAttribute("aria-describedby")).toBe("panel");
  });

  it("offers the pages that might fit, reachable with the arrow keys", async () => {
    respond({
      kind: "unsure",
      pages: [
        { href: "/events", title: "Events" },
        { href: "javascript:alert(1)", title: "Bad" },
        { href: "/history", title: "Local history" },
      ],
    });
    await search("something for a school project");
    const links = [...panel().querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["Events", "Local history"]);
    input().focus();
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(shadow().activeElement).toBe(links[0]);
  });

  it("closes on Escape, back to the input", async () => {
    respond({ kind: "none" });
    await search("parking permits");
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(shadow().activeElement).toBe(input());
  });

  it("says when search isn't working, and never follows a bad link", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await search("hours");
    expect(panel().textContent).toContain("isn't working");
    respond({ kind: "page", page: { href: "javascript:alert(1)", title: "x" } });
    await search("hours");
    expect(assign).not.toHaveBeenCalled();
    expect(panel().textContent).toContain("isn't working");
  });
});
