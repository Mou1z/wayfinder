import { findPage, type FindOptions } from "./find.ts";
import { openRouter } from "./providers/openrouter.ts";
import { suggestPages, type SuggestOptions } from "./suggest.ts";
import type {
  FindResult,
  Page,
  PageLink,
  Provider,
  SearchResponse,
  SuggestResponse,
  Suggestion,
} from "./types.ts";

export type WayfinderOptions<P extends Page> = Omit<FindOptions, "provider" | "signal"> & {
  /** Every page a search can send someone to. Pass a new array to change them. */
  pages: readonly P[];
  /** An OpenRouter API key: Jev chooses the pages. Without it (or `provider`), word matching does. */
  apiKey?: string | undefined;
  /** The OpenRouter model, with `apiKey`. Default `typesafe/jev-1.14`. */
  model?: string | undefined;
  /** Any other provider, instead of `apiKey`. */
  provider?: Provider;
  /** Settings for suggestions while typing, or `false` to answer them with none. */
  suggestions?: false | Pick<SuggestOptions, "minScore" | "limit" | "timeoutMs" | "instructions">;
};

export type Wayfinder<P extends Page> = {
  /** The page for `query`; see `findPage`. */
  find(query: string, signal?: AbortSignal): Promise<FindResult<P>>;
  /** The pages that fit what's being typed; see `suggestPages`. */
  suggest(query: string, signal?: AbortSignal): Promise<Suggestion<P>[]>;
  /**
   * The answer to a parsed request body from the search box, for servers without Web `Request`s
   * (Express, say): `{ status, body }` to send back as JSON.
   */
  answer(body: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }>;
  /** The endpoint itself, for anything with Web `Request`s: Next.js, Remix, Hono, Bun, Deno, Workers. */
  handle(request: Request): Promise<Response>;
};

const MAX_BODY = 4096;

/**
 * Wayfinder, set up once for a site: its pages, how to choose among them, and the endpoint the
 * search box posts to. Server-side only.
 *
 *   const wayfinder = createWayfinder({ pages, apiKey: process.env.OPENROUTER_API_KEY });
 *   export const POST = wayfinder.handle; // A Next.js route handler, say.
 */
export function createWayfinder<P extends Page>(options: WayfinderOptions<P>): Wayfinder<P> {
  const { pages, apiKey, model, suggestions, ...rest } = options;
  const provider = options.provider ?? (apiKey ? openRouter({ apiKey, model }) : undefined);
  const shared = { provider, site: rest.site, maxQueryLength: rest.maxQueryLength, onFallback: rest.onFallback };

  const find = (query: string, signal?: AbortSignal) =>
    findPage(query, pages, { ...rest, provider, ...(signal && { signal }) });
  const suggest = (query: string, signal?: AbortSignal) =>
    suggestPages(query, pages, { ...shared, ...(suggestions || {}), ...(signal && { signal }) });

  async function answer(body: unknown, signal?: AbortSignal) {
    const { query, suggest: wantsSuggestions } = (body ?? {}) as { query?: unknown; suggest?: unknown };
    if (typeof query !== "string" || !query.trim() || query.length > 1000)
      return { status: 400, body: { error: "Send { query } with some text in it" } };
    if (wantsSuggestions === true) {
      const found = suggestions === false ? [] : await suggest(query, signal);
      const reply: SuggestResponse = {
        suggestions: found.map(({ page, score }) => ({ page: link(page), score })),
      };
      return { status: 200, body: reply };
    }
    return { status: 200, body: forBrowser(await find(query, signal)) };
  }

  async function handle(request: Request) {
    if (request.method !== "POST")
      return json(405, { error: "Use POST" }, { Allow: "POST" });
    if (Number(request.headers.get("content-length")) > MAX_BODY)
      return json(413, { error: "Too large" });
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return json(413, { error: "Too large" });
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "Send JSON" });
    }
    try {
      const { status, body: reply } = await answer(body, request.signal);
      return json(status, reply);
    } catch {
      return json(500, { error: "Search failed" });
    }
  }

  return { find, suggest, answer, handle };
}

// Only what the search box needs: where each page is and what it's called.
const link = ({ href, title }: Page): PageLink => ({ href, title });

function forBrowser(result: FindResult<Page>): SearchResponse {
  if (result.kind === "page") return { ...result, page: link(result.page) };
  if (result.kind === "unsure") return { kind: "unsure", pages: result.pages.map(link) };
  return result;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
