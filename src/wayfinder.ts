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
  /** Every page a search can send someone to. To change them later, create a new Wayfinder. */
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

/** Just what Wayfinder uses of a Node or Express request. */
export type NodeRequest = AsyncIterable<Uint8Array | string> & {
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  /** Already parsed, by `express.json()` say. */
  body?: unknown;
};

/** Just what Wayfinder uses of a Node or Express response. */
export type NodeResponse = {
  statusCode: number;
  writableEnded?: boolean;
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
  on(event: "close", listener: () => void): unknown;
};

export type Wayfinder<P extends Page> = {
  /** The page for `query`; see `findPage`. */
  find(query: string, signal?: AbortSignal): Promise<FindResult<P>>;
  /** The pages that fit what's being typed; see `suggestPages`. */
  suggest(query: string, signal?: AbortSignal): Promise<Suggestion<P>[]>;
  /** The endpoint, for anything with Web `Request`s: Next.js, Remix, Hono, Bun, Deno, Workers. */
  handle(request: Request): Promise<Response>;
  /** The endpoint, for Node's own `http` server or Express: `app.post("/api/search", wayfinder.node)`. */
  node(request: NodeRequest, response: NodeResponse): Promise<void>;
  /** The answer to a request body you've read yourself: `{ status, body }` to send back as JSON. */
  answer(body: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }>;
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
  const { apiKey, model, suggestions, ...rest } = options;
  // A copy, so changing the list given doesn't change Wayfinder's halfway through a search.
  const pages = Object.freeze([...options.pages]);
  const provider = options.provider ?? (apiKey ? openRouter({ apiKey, model }) : undefined);

  const find = (query: string, signal?: AbortSignal) =>
    findPage(query, pages, { ...rest, provider, ...(signal && { signal }) });
  const suggest = (query: string, signal?: AbortSignal) =>
    suggestPages(query, pages, {
      provider,
      site: rest.site,
      maxQueryLength: rest.maxQueryLength,
      onFallback: rest.onFallback,
      ...(suggestions || {}),
      ...(signal && { signal }),
    });

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

  // What every endpoint does, however its request arrives. Requiring JSON means other sites'
  // pages can't call it without the browser asking first.
  async function respond(
    method: string | undefined,
    contentType: string | null | undefined,
    read: () => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    if (method !== "POST") return { status: 405, body: { error: "Use POST" } };
    if (contentType?.split(";")[0]!.trim().toLowerCase() !== "application/json")
      return { status: 415, body: { error: "Send JSON" } };
    let body: unknown;
    try {
      body = await read();
    } catch (error) {
      return error instanceof RangeError
        ? { status: 413, body: { error: "Too large" } }
        : { status: 400, body: { error: "Send JSON" } };
    }
    try {
      return await answer(body, signal);
    } catch {
      return { status: 500, body: { error: "Search failed" } };
    }
  }

  async function handle(request: Request) {
    const { status, body } = await respond(
      request.method,
      request.headers.get("content-type"),
      async () => JSON.parse(await readWeb(request.body)),
      request.signal,
    );
    return new Response(JSON.stringify(body), { status, headers: headers(status) });
  }

  async function node(request: NodeRequest, response: NodeResponse) {
    // If the visitor gives up, so does the search.
    const gone = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) gone.abort();
    });
    const type = request.headers["content-type"];
    const { status, body } = await respond(
      request.method,
      Array.isArray(type) ? type[0] : type,
      async () => (request.body !== undefined ? request.body : JSON.parse(await readNode(request))),
      gone.signal,
    );
    if (gone.signal.aborted) return;
    response.statusCode = status;
    for (const [name, value] of Object.entries(headers(status))) response.setHeader(name, value);
    response.end(JSON.stringify(body));
  }

  return { find, suggest, handle, node, answer };
}

// Only what the search box needs: where each page is and what it's called.
const link = ({ href, title }: Page): PageLink => ({ href, title });

function forBrowser(result: FindResult<Page>): SearchResponse {
  if (result.kind === "page") return { ...result, page: link(result.page) };
  if (result.kind === "unsure") return { kind: "unsure", pages: result.pages.map(link) };
  return result;
}

const headers = (status: number): Record<string, string> => ({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  ...(status === 405 && { Allow: "POST" }),
});

// The body as text, stopping (with a RangeError) as soon as it's longer than MAX_BODY, whatever
// Content-Length says.
async function readWeb(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new RangeError("Too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function readNode(request: NodeRequest): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.byteLength;
    if (size > MAX_BODY) throw new RangeError("Too large");
    text += decoder.decode(bytes, { stream: true });
  }
  return text + decoder.decode();
}
