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

  it("lets the host route instead by cancelling wayfinder-navigate", async () => {
    respond({ kind: "page", page: { href: "/hours", title: "Opening hours" } });
    const seen = vi.fn((event: Event) => event.preventDefault());
    element().addEventListener("wayfinder-navigate", seen);
    await search("hours");
    expect(seen.mock.calls[0]![0]).toMatchObject({ detail: { title: "Opening hours" } });
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

  it("drops its own look with unstyled, keeping what it needs to work", () => {
    expect(shadow().querySelectorAll("style")).toHaveLength(2);
    element().setAttribute("unstyled", "");
    expect(shadow().querySelectorAll("style")).toHaveLength(1);
  });
});

describe("<wayfinder-search suggest>", () => {
  beforeEach(() => {
    document.body.innerHTML = `<wayfinder-search endpoint="/api/search" suggest suggest-cooldown="0"></wayfinder-search>`;
  });

  const list = () => shadow().querySelector<HTMLElement>('[role="listbox"]')!;
  const key = (key: string) => input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  async function type(text: string) {
    fetchMock.mockResolvedValue(
      Response.json({
        suggestions: [
          { page: { href: "/study", title: "Study rooms" }, score: 0.92 },
          { page: { href: "/hours", title: "Opening hours" }, score: 0.71 },
        ],
      }),
    );
    input().value = text;
    input().dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(list().hidden).toBe(false));
  }

  it("is a combobox that lists matching pages with their scores", async () => {
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await type("somewhere to study");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ query: "somewhere to study", suggest: true });
    expect(input().getAttribute("aria-expanded")).toBe("true");
    const options = [...list().querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(["Study rooms92% match", "Opening hours71% match"]);
  });

  it("moves through the suggestions with the arrow keys, and goes on Enter", async () => {
    await type("somewhere to study");
    input().focus();
    key("ArrowDown");
    key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe("suggestion-1");
    key("ArrowDown");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    key("ArrowUp");
    expect(list().querySelector('[aria-selected="true"]')!.textContent).toContain("Opening hours");
    key("Enter");
    expect(assign).toHaveBeenCalledWith(new URL("/hours", location.href).href);
  });

  it("goes to a suggestion that's clicked", async () => {
    await type("somewhere to study");
    list().querySelector<HTMLElement>('[role="option"]')!.click();
    expect(assign).toHaveBeenCalledWith(new URL("/study", location.href).href);
  });

  it("closes the suggestions on Escape", async () => {
    await type("somewhere to study");
    input().focus();
    key("Escape");
    expect(list().hidden).toBe(true);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });
});
