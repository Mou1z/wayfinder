import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { findPage, openRouter, type FindResult } from "../../src/index.ts";
import { PAGES, type LibraryPage } from "./pages.ts";

// The demo: Fernhollow Library's pages, each with the search box in its header, and the endpoint
// the box posts to. With OPENROUTER_API_KEY in .env a decision model chooses; without it, word
// matching does. Nothing anyone types is logged or kept.

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));

const key = process.env.OPENROUTER_API_KEY;
const provider = key ? openRouter({ apiKey: key, model: process.env.OPENROUTER_MODEL }) : undefined;
const port = Number(process.env.PORT) || 3000;

async function search(request: IncomingMessage, response: ServerResponse) {
  let query: unknown;
  try {
    query = JSON.parse(await readBody(request, 2048)).query;
  } catch {
    return send(response, 400, "application/json", JSON.stringify({ error: "Bad request" }));
  }
  if (typeof query !== "string" || !query.trim() || query.length > 200)
    return send(response, 400, "application/json", JSON.stringify({ error: "Bad query" }));

  // If the visitor gives up, so does the search.
  const gone = new AbortController();
  response.on("close", () => gone.abort());
  const result = await findPage(query, PAGES, {
    provider,
    site: "Fernhollow Library, a public library with three branches",
    threshold: 0.5,
    signal: gone.signal,
    onFallback: (error) => console.warn(`Fell back to word matching: ${describe(error)}`),
  }).catch(() => undefined);
  if (!result) return;
  send(response, 200, "application/json", JSON.stringify(forBrowser(result)));
}

// Only what the search box needs: where each page is and what it's called.
function forBrowser(result: FindResult<LibraryPage>) {
  const link = ({ href, title }: LibraryPage) => ({ href, title });
  if (result.kind === "page") return { ...result, page: link(result.page) };
  if (result.kind === "unsure") return { kind: "unsure", pages: result.pages.map(link) };
  return result;
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  try {
    if (request.method === "POST" && pathname === "/api/search") return await search(request, response);
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    if (pathname === "/element.js" || pathname === "/element.js.map") {
      const file = await readFile(new URL(`dist${pathname}`, root));
      return send(response, 200, pathname.endsWith(".js") ? "text/javascript" : "application/json", file);
    }
    if (pathname === "/ask") return send(response, 200, "text/html", layout(ASK));
    const page = PAGES.find((p) => p.href === pathname);
    if (page) return send(response, 200, "text/html", layout(page));
    send(response, 404, "text/html", layout(MISSING));
  } catch (error) {
    console.error(`Request failed: ${describe(error)}`);
    if (!response.headersSent) send(response, 500, "text/plain", "Something went wrong");
  }
});

server.listen(port, () => {
  console.log(`Fernhollow Library demo: http://localhost:${port}`);
  console.log(
    provider
      ? `Choosing with OpenRouter (${process.env.OPENROUTER_MODEL || "typesafe/jev-1.14"}).`
      : "No OPENROUTER_API_KEY, so word matching answers. Add one to .env to use a model.",
  );
});

const ASK = {
  title: "Ask a librarian",
  about: "Couldn't find it? Ask us.",
  body: "Call 01632 960 000, or ask at any branch desk. (This is a made-up library: the number is a drama number.)",
};
const MISSING = { title: "Not found", about: "There's no page here.", body: "Try the search box above." };

const EXAMPLES = [
  "my kid is bored on saturday",
  "I lost my card",
  "can I print something",
  "my grandmother can't get out of the house",
  "old photos of my street",
  "listen to books in the car",
];

function layout(page: { href?: string; title: string; about: string; body: string }) {
  const examples =
    page.href === "/"
      ? `<h2>Things to try</h2><ul class="examples">${EXAMPLES.map((e) => `<li>${escape(e)}</li>`).join("")}</ul>
         <h2>Every page</h2><ul>${PAGES.slice(1)
           .map((p) => `<li><a href="${escape(p.href)}">${escape(p.title)}</a></li>`)
           .join("")}</ul>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(page.title)} · Fernhollow Library</title>
  <style>
    :root { color-scheme: light dark; --accent: #2f6b4f; font-family: system-ui, sans-serif; line-height: 1.5; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between;
      padding: 1rem clamp(1rem, 4vw, 3rem); border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
    header > a { font-weight: 700; font-size: 1.125rem; color: inherit; text-decoration: none; }
    main { max-width: 42rem; padding: 2rem clamp(1rem, 4vw, 3rem); }
    .lead { font-size: 1.125rem; opacity: .8; }
    .examples li { font-style: italic; }
    a { color: var(--accent); }
    wayfinder-search { --wayfinder-accent: var(--accent); }
    @media (prefers-color-scheme: dark) { :root { --accent: #7fc8a2; } wayfinder-search { --wayfinder-on-accent: #10261b; } }
  </style>
  <script type="module" src="/element.js"></script>
</head>
<body>
  <header>
    <a href="/">Fernhollow Library</a>
    <wayfinder-search endpoint="/api/search" label="Search the library" placeholder="What do you need?">
      <p slot="none"><a href="/ask">Ask a librarian</a>: we'll find it with you.</p>
    </wayfinder-search>
  </header>
  <main>
    <h1>${escape(page.title)}</h1>
    <p class="lead">${escape(page.about)}</p>
    <p>${escape(page.body)}</p>
    ${examples}
  </main>
</body>
</html>`;
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, { "Content-Type": `${type}; charset=utf-8` }).end(body);
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
