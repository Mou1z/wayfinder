import type { PageLink, SearchResponse, Suggestion } from "./types.ts";

// The search box's brain, without the box: talks to the endpoint, waits out the cooldown between
// suggestions, and keeps the state a search box shows. <wayfinder-search> is built on it; use it
// directly to build your own search box in any framework.
//
//   const search = createSearch({ endpoint: "/api/search", suggest: true });
//   search.subscribe((state) => render(state));
//   input.oninput = () => search.type(input.value);
//   form.onsubmit = (event) => { event.preventDefault(); search.submit(input.value); };

export type SearchState = {
  /** `none`, `unsure` and `error` are answers to show until the visitor types again. */
  status: "idle" | "searching" | "none" | "unsure" | "error";
  /** With `unsure`: the pages that might fit. */
  pages: PageLink[];
  /** With suggestions on: pages that fit what's being typed, best first. */
  suggestions: Suggestion<PageLink>[];
};

export type SearchOptions = {
  /** Where the server's Wayfinder endpoint is. */
  endpoint: string;
  /** Suggest pages while the visitor types. Default false. */
  suggest?: boolean;
  /**
   * The least time between two requests for suggestions, in milliseconds, so typing doesn't run
   * up the provider's bill. Default 2000.
   */
  cooldownMs?: number;
  /** How long typing has to pause before suggestions are asked for. Default 300. */
  pauseMs?: number;
  /** How many characters have to be typed before suggestions are asked for. Default 3. */
  minLength?: number;
  /** How long to wait for the endpoint before giving up. Default 10000. */
  timeoutMs?: number;
  /** Goes to a page. Default: `location.assign(page.href)`. Replace it to use a router. */
  navigate?: (page: PageLink) => void;
};

export type SearchClient = {
  readonly state: SearchState;
  /** Calls `listener` with every new state; returns the way to stop. */
  subscribe(listener: (state: SearchState) => void): () => void;
  /** Call with the box's text whenever it changes. */
  type(text: string): void;
  /** Searches for `text` and goes to the page that fits, or shows `none` or `unsure`. */
  submit(text: string): Promise<void>;
  /** Goes to a page from the suggestions or an `unsure` answer. */
  go(page: PageLink): void;
  /** Hides the answer and the suggestions (on Escape, say). */
  dismiss(): void;
  /** Stops everything in flight; call when the box goes away. */
  destroy(): void;
};

const IDLE: SearchState = { status: "idle", pages: [], suggestions: [] };
// Suggestions already fetched, by query, so backspacing doesn't ask again.
const REMEMBERED = 30;

export function createSearch(options: SearchOptions): SearchClient {
  const {
    endpoint,
    cooldownMs = 2000,
    pauseMs = 300,
    minLength = 3,
    timeoutMs = 10_000,
    navigate = (page: PageLink) => location.assign(page.href),
  } = options;
  const listeners = new Set<(state: SearchState) => void>();
  const remembered = new Map<string, Suggestion<PageLink>[]>();
  let state = IDLE;
  let typed = ""; // What's in the box, trimmed.
  let submitted = ""; // What's being searched for.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAsked = -Infinity;
  let suggesting: AbortController | undefined;
  let searching: AbortController | undefined;
  let destroyed = false;

  const set = (next: Partial<SearchState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };

  const post = async (body: object, signal: AbortSignal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: either(signal, timeoutMs),
    });
    if (!response.ok) throw new Error(`The search endpoint answered ${response.status}`);
    return response.json() as Promise<unknown>;
  };

  const stopSuggesting = () => {
    clearTimeout(timer);
    suggesting?.abort();
    suggesting = undefined;
  };

  const stopSearching = () => {
    searching?.abort();
    searching = undefined;
  };

  async function suggest(query: string) {
    suggesting?.abort();
    const controller = (suggesting = new AbortController());
    lastAsked = Date.now();
    try {
      const found = parseSuggestions(await post({ query, suggest: true }, controller.signal));
      remembered.set(query, found);
      if (remembered.size > REMEMBERED) remembered.delete(remembered.keys().next().value!);
      if (suggesting === controller && typed === query) set({ suggestions: found });
    } catch {
      // Suggestions are a nicety: without them, the search still works.
    }
  }

  const go = (page: PageLink) => {
    if (destroyed) return;
    stopSuggesting();
    stopSearching();
    set(IDLE);
    navigate(page);
  };

  return {
    get state() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    type(text) {
      if (destroyed) return;
      typed = text.trim();
      // New words replace the answer on show, or the search under way for the old ones.
      if (state.status === "searching") {
        if (typed === submitted) return;
        stopSearching();
      }
      if (state.status !== "idle") set({ status: "idle", pages: [] });
      clearTimeout(timer);
      if (!options.suggest || typed.length < minLength) {
        stopSuggesting();
        if (state.suggestions.length > 0) set({ suggestions: [] });
        return;
      }
      const known = remembered.get(typed);
      if (known) return set({ suggestions: known });
      const query = typed;
      timer = setTimeout(() => suggest(query), Math.max(pauseMs, lastAsked + cooldownMs - Date.now()));
    },

    async submit(text) {
      const query = text.trim();
      if (!query || destroyed) return;
      stopSuggesting();
      stopSearching();
      const controller = (searching = new AbortController());
      submitted = typed = query;
      set({ status: "searching", pages: [], suggestions: [] });
      let result: SearchResponse | undefined;
      try {
        result = parseResult(await post({ query }, controller.signal));
      } catch {
        // An error, unless a newer search took over or the box went away (checked next).
      }
      if (searching !== controller) return;
      searching = undefined;
      if (!result) return set({ status: "error" });
      if (result.kind === "page") return go(result.page);
      set({ status: result.kind, pages: result.kind === "unsure" ? result.pages : [] });
    },

    go,

    dismiss() {
      stopSuggesting();
      if (state.status === "searching") set({ suggestions: [] });
      else if (state !== IDLE) set(IDLE);
    },

    destroy() {
      destroyed = true;
      stopSuggesting();
      stopSearching();
      listeners.clear();
    },
  };
}

// Aborts when `signal` does or `ms` pass (AbortSignal.any isn't in every browser yet).
function either(signal: AbortSignal, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

// What the endpoint sent, if the search box can act on it. Only http(s) links are followed,
// whatever the endpoint says.
function parseResult(body: unknown): SearchResponse | undefined {
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

function parseSuggestions(body: unknown): Suggestion<PageLink>[] {
  const list = (body as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) throw new Error("Not suggestions");
  return list.flatMap((item: { page?: unknown; score?: unknown }) => {
    const page = link(item?.page);
    return page && typeof item.score === "number" ? [{ page, score: item.score }] : [];
  });
}

function link(page: unknown): PageLink | undefined {
  const { href, title } = (page ?? {}) as { href?: unknown; title?: unknown };
  if (typeof href !== "string" || typeof title !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? { href: url.href, title } : undefined;
}
