import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createWayfinder, DEFAULT_OPENROUTER_MODEL } from "../../src/index.ts";
import { PAGES } from "./pages.ts";

// The demo: Fernhollow Library's pages, each with the search box in its header, and the endpoint
// the box posts to. With OPENROUTER_API_KEY in .env, Jev chooses; without it, word matching does.
// Nothing anyone types is logged or kept.

const root = new URL("../../", import.meta.url);
if (existsSync(new URL(".env", root))) process.loadEnvFile(new URL(".env", root));
const port = Number(process.env.PORT) || 3000;

const wayfinder = createWayfinder({
  pages: PAGES,
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL,
  site: "Fernhollow Library, a public library with three branches",
  threshold: 0.5,
  onFallback: (error) => console.warn(`Fell back to word matching: ${describe(error)}`),
});

// What the browser may load from dist/.
const SCRIPTS = new Set(["/element.js", "/client.js"]);

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  try {
    if (pathname === "/api/search") return await wayfinder.node(request, response);
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    if (SCRIPTS.has(pathname)) {
      const file = await readFile(new URL(`dist${pathname}`, root));
      return send(response, 200, "text/javascript", file);
    }
    if (pathname === "/ask") return send(response, 200, "text/html", layout(ASK));
    if (pathname === "/build-your-own") return send(response, 200, "text/html", layout(CUSTOM));
    const page = PAGES.find((p) => p.href === pathname);
    if (page) return send(response, 200, "text/html", layout(page));
    send(response, 404, "text/html", layout(MISSING));
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    console.error(`Request failed: ${describe(error)}`);
    send(response, 500, "text/plain", "Something went wrong");
  }
});

server.listen(port, () => {
  console.log(`Fernhollow Library demo: http://localhost:${port}`);
  console.log(
    process.env.OPENROUTER_API_KEY
      ? `Choosing with OpenRouter (${process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL}).`
      : "No OPENROUTER_API_KEY, so word matching answers. Add one to .env to use Jev.",
  );
});

const ASK = {
  title: "Ask a librarian",
  about: "Couldn't find it? Ask us.",
  body: "Call 01632 960 000, or ask at any branch desk. (This is a made-up library: the number is a drama number.)",
};
const MISSING = { title: "Not found", about: "There's no page here.", body: "Try the search box above." };

// The same search, with a search box built from scratch on wayfinder-search/client.
const CUSTOM = {
  title: "Build your own search box",
  about: "The search box in the header is ready-made. This one is built from scratch on the client, in a few lines.",
  body: "View this page's source to see how.",
  extra: `
  <form id="ask" role="search" class="ask">
    <label for="ask-input">Ask the library anything</label>
    <div class="ask-row">
      <input id="ask-input" type="search" autocomplete="off" placeholder="e.g. somewhere quiet to revise">
      <button>Go</button>
    </div>
    <p id="ask-status" role="status"></p>
    <ul id="ask-list"></ul>
  </form>
  <script type="module">
    import { createSearch } from "/client.js";

    const search = createSearch({ endpoint: "/api/search", suggest: true });
    const form = document.querySelector("#ask");
    const input = document.querySelector("#ask-input");
    const status = document.querySelector("#ask-status");
    const list = document.querySelector("#ask-list");

    input.addEventListener("input", () => search.type(input.value));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      search.submit(input.value);
    });

    search.subscribe(({ status: now, pages, suggestions }) => {
      status.textContent = {
        idle: "", searching: "Looking…", error: "Search isn't working. Try again?",
        none: "Nothing fits. Ask a librarian on 01632 960 000.", unsure: "One of these?",
      }[now];
      const shown = now === "unsure" ? pages.map((page) => ({ page })) : suggestions;
      list.replaceChildren(...shown.map(({ page, score }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = score ? page.title + " · " + Math.round(score * 100) + "%" : page.title;
        button.onclick = () => search.go(page);
        const item = document.createElement("li");
        item.append(button);
        return item;
      }));
    });
  </script>`,
};

const EXAMPLES = [
  "my kid is bored on saturday",
  "I lost my card",
  "can I print something",
  "my grandmother can't get out of the house",
  "old photos of my street",
  "listen to books in the car",
];

function layout(page: { href?: string; title: string; about: string; body: string; extra?: string }) {
  const extra =
    page.extra ??
    (page.href === "/"
      ? `<h2>Things to try</h2><ul class="examples">${EXAMPLES.map((e) => `<li>${escape(e)}</li>`).join("")}</ul>
         <p>Or see <a href="/build-your-own">a search box built from scratch</a> on the same endpoint.</p>
         <h2>Every page</h2><ul>${PAGES.slice(1)
           .map((p) => `<li><a href="${escape(p.href)}">${escape(p.title)}</a></li>`)
           .join("")}</ul>`
      : "");
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
    .ask { margin-top: 2rem; padding: 1.5rem; border-radius: 1rem; background: color-mix(in srgb, var(--accent) 10%, Canvas); }
    .ask label { display: block; font-weight: 600; margin-bottom: .5rem; }
    .ask-row { display: flex; gap: .5rem; }
    .ask input { flex: 1; min-width: 0; padding: .75rem 1rem; font: inherit; border: 2px solid var(--accent); border-radius: .5rem; }
    .ask button { padding: .5rem 1rem; font: inherit; border: 0; border-radius: .5rem; background: var(--accent); color: Canvas; cursor: pointer; }
    .ask ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
    .ask li button { background: Canvas; color: var(--accent); border: 1px solid var(--accent); }
    @media (prefers-color-scheme: dark) { :root { --accent: #7fc8a2; } wayfinder-search { --wayfinder-on-accent: #10261b; } }
  </style>
  <script type="module" src="/element.js"></script>
</head>
<body>
  <header>
    <a href="/">Fernhollow Library</a>
    <wayfinder-search endpoint="/api/search" suggest label="Search the library" placeholder="What do you need?">
      <p slot="none"><a href="/ask">Ask a librarian</a>: we'll find it with you.</p>
    </wayfinder-search>
  </header>
  <main>
    <h1>${escape(page.title)}</h1>
    <p class="lead">${escape(page.about)}</p>
    <p>${escape(page.body)}</p>
    ${extra}
  </main>
</body>
</html>`;
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, { "Content-Type": `${type}; charset=utf-8` }).end(body);
}


const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
