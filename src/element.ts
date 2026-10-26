import type { FindResult } from "./types.ts";

// <wayfinder-search>: the search box, for the browser. It posts what's typed to the host's own
// endpoint (which calls findPage() on the server, where the API key lives) and goes to the page
// that comes back, or says nothing fits, or offers the few pages that might.
//
//   <wayfinder-search endpoint="/api/search" label="Search the library">
//     <p slot="none">Nothing here covers that. <a href="/ask">Ask a librarian</a></p>
//   </wayfinder-search>
//
// Before going anywhere it fires a cancelable `wayfinder-result` event with the result as its
// detail: cancel it to route yourself (a single-page app's router, say).

type Result = FindResult<{ href: string; title: string }>;

const TEXT = {
  label: "Search this site",
  placeholder: "What are you looking for?",
  searching: "Searching…",
  "unsure-label": "Did you mean one of these?",
  "none-label": "Nothing on the site fits that.",
  "error-label": "Search isn't working right now. Please try again.",
} as const;
type TextName = keyof typeof TEXT;

const STYLE = `
  :host { display: inline-block; position: relative; font: inherit; color: var(--wayfinder-fg, CanvasText);
    --_accent: var(--wayfinder-accent, #2457d6); --_bg: var(--wayfinder-bg, Canvas); --_on-accent: var(--wayfinder-on-accent, #fff);
    --_line: var(--wayfinder-border, color-mix(in srgb, currentColor 30%, transparent));
    --_radius: var(--wayfinder-radius, 999px); }
  :host([hidden]) { display: none; }
  .hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap; border: 0; }
  form { margin: 0; }
  .field { display: flex; align-items: center; gap: .25rem; min-width: 16rem; padding: .25rem .25rem .25rem 1rem;
    border: 1px solid var(--_line); border-radius: var(--_radius); background: var(--_bg); }
  .field:focus-within { border-color: var(--_accent); outline: 2px solid color-mix(in srgb, var(--_accent) 35%, transparent); outline-offset: 1px; }
  input { flex: 1; min-width: 0; border: 0; padding: .375rem 0; background: transparent; color: inherit; font: inherit; outline: none; }
  input::-webkit-search-cancel-button { cursor: pointer; }
  button { display: grid; place-items: center; width: 2rem; height: 2rem; flex: none; padding: 0; border: 0;
    border-radius: 999px; background: var(--_accent); color: var(--_on-accent); cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
  .spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
    animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
  [part="panel"] { position: absolute; z-index: 50; top: calc(100% + .5rem); inset-inline-end: 0; width: max(100%, 20rem);
    box-sizing: border-box; padding: 1rem; border: 1px solid var(--_line); border-radius: .75rem; background: var(--_bg);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / .3); }
  @media (max-width: 40rem) { [part="panel"] { width: 100%; } }
  [part="panel"][hidden] { display: none; }
  [part="panel"] p { margin: 0; }
  ul { list-style: none; margin: .5rem 0 0; padding: 0; display: grid; gap: .25rem; }
  a { color: var(--_accent); }
  li a { display: block; padding: .375rem .5rem; border-radius: .375rem; text-decoration: none; }
  li a:hover, li a:focus-visible { background: color-mix(in srgb, var(--_accent) 12%, transparent); outline: none; text-decoration: underline; }
  ::slotted(*) { margin: .5rem 0 0; }
`;

const ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.75"/>
  <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;

// On a server (an import during server rendering, say) there's no HTMLElement to extend.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

export class WayfinderSearch extends Base {
  static observedAttributes = ["label", "placeholder"];

  #root = this.attachShadow({ mode: "open" });
  #input!: HTMLInputElement;
  #button!: HTMLButtonElement;
  #status!: HTMLElement;
  #panel!: HTMLElement;
  #label!: HTMLElement;
  #pending: AbortController | undefined;

  constructor() {
    super();
    this.#root.innerHTML = `
      <style>${STYLE}</style>
      <form role="search" part="form">
        <label part="label" for="query" class="hidden"></label>
        <div class="field" part="field">
          <input id="query" part="input" type="search" name="query" autocomplete="off" enterkeyhint="search" maxlength="200">
          <button part="button" type="submit"></button>
        </div>
      </form>
      <p class="hidden" role="status"></p>
      <div part="panel" id="panel" hidden></div>`;
    this.#input = this.#root.querySelector("input")!;
    this.#button = this.#root.querySelector("button")!;
    this.#status = this.#root.querySelector('[role="status"]')!;
    this.#panel = this.#root.querySelector("#panel")!;
    this.#label = this.#root.querySelector("label")!;
    this.#idle();

    this.#root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#search(this.#input.value);
    });
    this.#input.addEventListener("input", () => this.#close());
    this.#root.addEventListener("keydown", (event) => this.#key(event as KeyboardEvent));
  }

  connectedCallback() {
    this.attributeChangedCallback();
    document.addEventListener("pointerdown", this.#outside);
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.#outside);
    this.#pending?.abort();
  }

  attributeChangedCallback() {
    this.#label.textContent = this.#text("label");
    this.#input.placeholder = this.#text("placeholder");
  }

  #text(name: TextName) {
    return this.getAttribute(name) || TEXT[name];
  }

  async #search(typed: string) {
    const query = typed.trim();
    if (!query) return;
    this.#pending?.abort();
    const pending = (this.#pending = new AbortController());
    this.#close();
    this.#busy(true);

    let result: Result | undefined;
    try {
      const endpoint = this.getAttribute("endpoint");
      if (!endpoint) throw new Error("<wayfinder-search> needs an endpoint attribute");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.any([pending.signal, AbortSignal.timeout(10_000)]),
      });
      if (response.ok) result = parse(await response.json());
    } catch {
      if (pending.signal.aborted) return; // A newer search took over.
    } finally {
      if (this.#pending === pending) {
        this.#pending = undefined;
        this.#busy(false);
      }
    }
    if (!result) return this.#open("error");

    const proceed = this.dispatchEvent(
      new CustomEvent("wayfinder-result", {
        detail: result,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    if (result.kind === "page") {
      this.#input.value = "";
      if (proceed) location.assign(result.page.href);
    } else if (proceed) {
      this.#open(result.kind, result.kind === "unsure" ? result.pages : []);
    }
  }

  #busy(busy: boolean) {
    this.#root.querySelector("form")!.setAttribute("aria-busy", String(busy));
    this.#status.textContent = busy ? this.#text("searching") : "";
    if (busy) {
      this.#button.innerHTML = `<span class="spinner" aria-hidden="true"></span>`;
      this.#button.setAttribute("aria-label", this.#text("searching"));
    } else this.#idle();
  }

  #idle() {
    this.#button.innerHTML = ICON;
    this.#button.setAttribute("aria-label", "Search");
  }

  #open(kind: "none" | "unsure" | "error", pages: { href: string; title: string }[] = []) {
    const message = document.createElement("p");
    message.id = "message";
    message.textContent = this.#text(`${kind}-label`);
    this.#panel.replaceChildren(message);
    if (kind === "none") {
      const slot = document.createElement("slot");
      slot.name = "none";
      this.#panel.append(slot);
    }
    if (kind === "unsure") {
      const list = document.createElement("ul");
      list.setAttribute("aria-labelledby", "message");
      for (const page of pages) {
        const link = document.createElement("a");
        link.href = page.href;
        link.textContent = page.title;
        link.setAttribute("part", "option");
        const item = document.createElement("li");
        item.append(link);
        list.append(item);
      }
      this.#panel.append(list);
    }
    this.#panel.hidden = false;
    this.#panel.dataset.kind = kind;
    this.#input.setAttribute("aria-describedby", "panel");
    this.#status.textContent =
      kind === "unsure" ? `${message.textContent} ${pages.length} pages.` : message.textContent;
  }

  #close() {
    if (this.#panel.hidden) return;
    this.#panel.hidden = true;
    this.#panel.replaceChildren();
    delete this.#panel.dataset.kind;
    this.#input.removeAttribute("aria-describedby");
    this.#status.textContent = "";
  }

  // Escape closes; the arrow keys move between the input and the pages offered.
  #key(event: KeyboardEvent) {
    if (event.key === "Escape" && !this.#panel.hidden) {
      event.preventDefault();
      this.#close();
      this.#input.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = [...this.#panel.querySelectorAll("a")];
    if (links.length === 0) return;
    const at = links.indexOf(this.#root.activeElement as HTMLAnchorElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    event.preventDefault();
    if (next < 0) this.#input.focus();
    else links[Math.min(next, links.length - 1)]!.focus();
  }

  #outside = (event: Event) => {
    if (!event.composedPath().includes(this)) this.#close();
  };
}

// What the endpoint sent, if it's a result this element can act on. Only http(s) links are
// followed, whatever the endpoint says.
function parse(body: unknown): Result | undefined {
  const value = body as Partial<Record<string, unknown>> | null;
  if (value?.kind === "none") return { kind: "none" };
  if (value?.kind === "page") {
    const page = link(value.page);
    return page && { kind: "page", page };
  }
  if (value?.kind === "unsure" && Array.isArray(value.pages)) {
    const pages = value.pages.map(link).filter((page) => page !== undefined);
    return pages.length > 0 ? { kind: "unsure", pages } : { kind: "none" };
  }
  return undefined;
}

function link(page: unknown): { href: string; title: string } | undefined {
  const { href, title } = (page ?? {}) as { href?: unknown; title?: unknown };
  if (typeof href !== "string" || typeof title !== "string") return undefined;
  const url = URL.parse(href, location.href);
  return url && (url.protocol === "http:" || url.protocol === "https:") ? { href: url.href, title } : undefined;
}

if (typeof customElements !== "undefined" && !customElements.get("wayfinder-search"))
  customElements.define("wayfinder-search", WayfinderSearch);

declare global {
  interface HTMLElementTagNameMap {
    "wayfinder-search": WayfinderSearch;
  }
}
