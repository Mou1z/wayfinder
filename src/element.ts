import { createSearch, type SearchClient, type SearchState } from "./client.ts";
import type { PageLink } from "./types.ts";

// <wayfinder-search>: the ready-made search box. It posts what's typed to your endpoint (which
// runs Wayfinder on the server, where the API key lives) and goes to the page that comes back, or
// says nothing fits, or offers the few pages that might. With `suggest`, it also lists matching
// pages while the visitor types.
//
//   <wayfinder-search endpoint="/api/search" suggest>
//     <p slot="none">Nothing here covers that. <a href="/contact">Ask us</a></p>
//   </wayfinder-search>
//
// Before going to a page it fires a cancelable `wayfinder-navigate` event (the page is its
// detail): cancel it to route yourself. For a search box of your own, use the client instead.

const TEXT = {
  label: "Search this site",
  placeholder: "What are you looking for?",
  searching: "Searching…",
  "unsure-label": "Did you mean one of these?",
  "none-label": "Nothing on the site fits that.",
  "error-label": "Search isn't working right now. Please try again.",
  "suggestions-label": "Suggested pages",
} as const;
type TextName = keyof typeof TEXT;

// Only what it takes to work: with `unstyled`, this is all there is.
const LAYOUT = `
  :host { display: inline-block; position: relative; }
  :host([hidden]) { display: none; }
  .hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap; border: 0; }
  [hidden] { display: none !important; }
  .field { display: flex; align-items: center; }
  input { flex: 1; min-width: 0; }
  .popup { position: absolute; z-index: 50; top: calc(100% + .5rem); inset-inline-end: 0; box-sizing: border-box; }
  ul { list-style: none; margin: 0; padding: 0; }
  :host([hide-scores]) [part="score"] { display: none; }
`;

const LOOK = `
  :host { font: inherit; color: var(--wayfinder-fg, CanvasText);
    --_accent: var(--wayfinder-accent, #2457d6); --_on-accent: var(--wayfinder-on-accent, #fff);
    --_bg: var(--wayfinder-bg, Canvas); --_radius: var(--wayfinder-radius, 999px);
    --_line: var(--wayfinder-border, color-mix(in srgb, currentColor 30%, transparent)); }
  form { margin: 0; }
  .field { gap: .25rem; min-width: 16rem; padding: .25rem .25rem .25rem 1rem; border: 1px solid var(--_line);
    border-radius: var(--_radius); background: var(--_bg); }
  .field:focus-within { border-color: var(--_accent);
    outline: 2px solid color-mix(in srgb, var(--_accent) 35%, transparent); outline-offset: 1px; }
  input { border: 0; padding: .375rem 0; background: transparent; color: inherit; font: inherit; outline: none; }
  button { display: grid; place-items: center; width: 2rem; height: 2rem; flex: none; padding: 0; border: 0;
    border-radius: 999px; background: var(--_accent); color: var(--_on-accent); cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
  .spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent;
    border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
  .popup { width: max(100%, 20rem); padding: .5rem; border: 1px solid var(--_line); border-radius: .75rem;
    background: var(--_bg); box-shadow: 0 12px 32px -12px rgb(0 0 0 / .3); }
  @media (max-width: 40rem) { .popup { width: 100%; } }
  [part="panel"] { padding: 1rem; }
  [part="panel"] p { margin: 0; }
  [part="panel"] ul { margin-top: .5rem; display: grid; gap: .25rem; }
  a { color: var(--_accent); }
  [part="panel"] li a { display: block; padding: .375rem .5rem; border-radius: .375rem; text-decoration: none; }
  [part="panel"] li a:hover, [part="panel"] li a:focus-visible { outline: none; text-decoration: underline;
    background: color-mix(in srgb, var(--_accent) 12%, transparent); }
  [role="option"] { display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; border-radius: .5rem;
    cursor: pointer; }
  [role="option"]:hover, [role="option"][aria-selected="true"] { background: color-mix(in srgb, var(--_accent) 12%, transparent); }
  [part="suggestion-title"] { flex: 1; }
  [part="score"] { flex: none; padding: .125rem .5rem; border-radius: 999px; font-size: .8125em; font-variant-numeric: tabular-nums;
    color: var(--_accent); background: color-mix(in srgb, var(--_accent) 12%, transparent); }
  ::slotted(*) { margin: .5rem 0 0; }
`;

const ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.75"/>
  <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>`;
const SPINNER = `<span class="spinner" aria-hidden="true"></span>`;

// On a server (an import during server rendering, say) there's no HTMLElement to extend.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

export class WayfinderSearch extends Base {
  static observedAttributes = ["endpoint", "suggest", "suggest-cooldown", "label", "placeholder", "unstyled"];

  #root = this.attachShadow({ mode: "open" });
  #look = document.createElement("style");
  #form!: HTMLFormElement;
  #input!: HTMLInputElement;
  #button!: HTMLButtonElement;
  #status!: HTMLElement;
  #panel!: HTMLElement;
  #list!: HTMLElement;
  #client: SearchClient | undefined;
  #stop: (() => void) | undefined;
  #shown: SearchState | undefined;
  #active = -1; // The suggestion the arrow keys are on.

  constructor() {
    super();
    this.#root.innerHTML = `
      <style>${LAYOUT}</style>
      <form role="search" part="form">
        <label part="label" for="query" class="hidden"></label>
        <div class="field" part="field">
          <input id="query" part="input" type="search" name="query" autocomplete="off" enterkeyhint="search" maxlength="200">
          <button part="button" type="submit" aria-label="Search">${ICON}</button>
        </div>
      </form>
      <ul part="suggestions" id="suggestions" class="popup" role="listbox" hidden></ul>
      <div part="panel" id="panel" class="popup" hidden></div>
      <p class="hidden" role="status"></p>`;
    this.#look.textContent = LOOK;
    const $ = <E extends Element>(selector: string) => this.#root.querySelector<E>(selector)!;
    this.#form = $("form");
    this.#input = $("input");
    this.#button = $("button");
    this.#status = $('[role="status"]');
    this.#panel = $("#panel");
    this.#list = $("#suggestions");

    this.#form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#client?.submit(this.#input.value);
    });
    this.#input.addEventListener("input", () => this.#client?.type(this.#input.value));
    this.#root.addEventListener("keydown", (event) => this.#key(event as KeyboardEvent));
    // Choosing a suggestion with the mouse shouldn't take focus from the box.
    this.#list.addEventListener("pointerdown", (event) => event.preventDefault());
    this.#list.addEventListener("click", (event) => {
      const option = (event.target as Element).closest('[role="option"]');
      const chosen = this.#shown?.suggestions[Number(option?.getAttribute("data-index"))];
      if (chosen) this.#client?.go(chosen.page);
    });
  }

  connectedCallback() {
    document.addEventListener("pointerdown", this.#outside);
    this.#setUp();
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.#outside);
    this.#tearDown();
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === "endpoint" || name === "suggest" || name === "suggest-cooldown") {
      this.#tearDown();
      this.#setUp();
    } else this.#text();
  }

  #setUp() {
    this.#text();
    const endpoint = this.getAttribute("endpoint");
    if (!endpoint) return;
    const suggest = this.hasAttribute("suggest");
    const cooldown = Number(this.getAttribute("suggest-cooldown"));
    this.#client = createSearch({
      endpoint,
      suggest,
      ...(this.getAttribute("suggest-cooldown") !== null && cooldown >= 0 && { cooldownMs: cooldown }),
      navigate: (page) => this.#navigate(page),
    });
    this.#stop = this.#client.subscribe((state) => this.#render(state));
    if (suggest) {
      this.#input.setAttribute("role", "combobox");
      this.#input.setAttribute("aria-autocomplete", "list");
      this.#input.setAttribute("aria-controls", "suggestions");
      this.#input.setAttribute("aria-expanded", "false");
    } else {
      for (const name of ["role", "aria-autocomplete", "aria-controls", "aria-expanded"])
        this.#input.removeAttribute(name);
    }
  }

  #tearDown() {
    this.#stop?.();
    this.#client?.destroy();
    this.#client = undefined;
    this.#render({ status: "idle", pages: [], suggestions: [] });
  }

  #text() {
    this.#root.querySelector("label")!.textContent = this.#says("label");
    this.#input.placeholder = this.#says("placeholder");
    this.#list.setAttribute("aria-label", this.#says("suggestions-label"));
    if (this.hasAttribute("unstyled")) this.#look.remove();
    else this.#root.append(this.#look);
  }

  #says(name: TextName) {
    return this.getAttribute(name) || TEXT[name];
  }

  #navigate(page: PageLink) {
    this.#input.value = "";
    const proceed = this.dispatchEvent(
      new CustomEvent("wayfinder-navigate", { detail: page, bubbles: true, composed: true, cancelable: true }),
    );
    if (proceed) location.assign(page.href);
  }

  #render(state: SearchState) {
    const before = this.#shown;
    this.#shown = state;
    const searching = state.status === "searching";
    if (searching !== (before?.status === "searching")) {
      this.#form.setAttribute("aria-busy", String(searching));
      this.#button.innerHTML = searching ? SPINNER : ICON;
      this.#button.setAttribute("aria-label", searching ? this.#says("searching") : "Search");
    }
    if (state.status !== before?.status || state.pages !== before?.pages) this.#renderPanel(state);
    if (state.suggestions !== before?.suggestions) this.#renderSuggestions(state);
  }

  #renderPanel({ status, pages }: SearchState) {
    if (status === "idle" || status === "searching") {
      this.#panel.hidden = true;
      this.#panel.replaceChildren();
      this.#input.removeAttribute("aria-describedby");
      this.#announce(status === "searching" ? this.#says("searching") : "");
      return;
    }
    const message = document.createElement("p");
    message.id = "message";
    message.textContent = this.#says(`${status}-label`);
    this.#panel.replaceChildren(message);
    if (status === "none") {
      const slot = document.createElement("slot");
      slot.name = "none";
      this.#panel.append(slot);
    }
    if (status === "unsure") {
      const list = document.createElement("ul");
      list.setAttribute("aria-labelledby", "message");
      for (const page of pages) {
        const link = document.createElement("a");
        link.href = page.href;
        link.textContent = page.title;
        link.setAttribute("part", "option");
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.#client?.go(page);
        });
        const item = document.createElement("li");
        item.append(link);
        list.append(item);
      }
      this.#panel.append(list);
    }
    this.#panel.hidden = false;
    this.#input.setAttribute("aria-describedby", "panel");
    this.#announce(status === "unsure" ? `${message.textContent} ${pages.length} pages.` : message.textContent);
  }

  #renderSuggestions({ suggestions }: SearchState) {
    this.#active = -1;
    this.#input.removeAttribute("aria-activedescendant");
    this.#list.replaceChildren(
      ...suggestions.map(({ page, score }, i) => {
        const option = document.createElement("li");
        option.id = `suggestion-${i}`;
        option.dataset.index = String(i);
        option.setAttribute("role", "option");
        option.setAttribute("part", "suggestion");
        option.setAttribute("aria-selected", "false");
        const title = document.createElement("span");
        title.setAttribute("part", "suggestion-title");
        title.textContent = page.title;
        const match = document.createElement("span");
        match.setAttribute("part", "score");
        match.textContent = `${Math.round(score * 100)}%`;
        const spoken = document.createElement("span");
        spoken.className = "hidden";
        spoken.textContent = " match";
        match.append(spoken);
        option.append(title, match);
        return option;
      }),
    );
    const open = suggestions.length > 0;
    this.#list.hidden = !open;
    if (this.#input.hasAttribute("role")) this.#input.setAttribute("aria-expanded", String(open));
    if (open) this.#announce(`${suggestions.length} suggested ${suggestions.length === 1 ? "page" : "pages"}.`);
  }

  #announce(text: string) {
    this.#status.textContent = text;
  }

  // Escape closes. The arrow keys move through the suggestions (Enter goes to the one chosen), or
  // between the input and the pages an unsure answer offers.
  #key(event: KeyboardEvent) {
    const state = this.#shown;
    if (!state) return;
    if (event.key === "Escape" && (!this.#list.hidden || !this.#panel.hidden)) {
      event.preventDefault();
      this.#client?.dismiss();
      this.#input.focus();
      return;
    }
    if (!this.#list.hidden && this.#root.activeElement === this.#input) {
      const count = state.suggestions.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        // Past either end is back in the box.
        const next = this.#active + (event.key === "ArrowDown" ? 1 : -1);
        this.#choose(next < -1 ? count - 1 : next >= count ? -1 : next);
      } else if (event.key === "Enter" && this.#active >= 0) {
        event.preventDefault();
        this.#client?.go(state.suggestions[this.#active]!.page);
      }
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

  // Marks suggestion `index` as the one chosen; -1 is back in the box.
  #choose(index: number) {
    this.#list.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    this.#active = index;
    const option = index >= 0 ? this.#list.children[index] : undefined;
    if (option) {
      option.setAttribute("aria-selected", "true");
      this.#input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    } else this.#input.removeAttribute("aria-activedescendant");
  }

  #outside = (event: Event) => {
    if (!event.composedPath().includes(this)) this.#client?.dismiss();
  };
}

if (typeof customElements !== "undefined" && !customElements.get("wayfinder-search"))
  customElements.define("wayfinder-search", WayfinderSearch);

declare global {
  interface HTMLElementTagNameMap {
    "wayfinder-search": WayfinderSearch;
  }
}
