# Wayfinder guide

Everything beyond the [README](../README.md). Contents:

- [How it works](#how-it-works)
- [Your pages](#your-pages)
- [Your server](#your-server)
- [The search box](#the-search-box)
- [Suggestions while typing](#suggestions-while-typing)
- [Build your own search box](#build-your-own-search-box)
- [Providers](#providers)
- [Lower-level functions](#lower-level-functions)
- [Privacy and security](#privacy-and-security)
- [Limits](#limits)
- [Working on Wayfinder](#working-on-wayfinder)

## How it works

1. The visitor types into the search box. The box posts `{ "query": "..." }` to your endpoint.
2. Your endpoint asks the provider (Jev, by default) one question: *which of these pages best answers this?* The options are your pages, plus `none`.
3. The provider picks one of the options. Wayfinder checks that the pick really is one of your pages, and the endpoint sends it back.
4. The box goes to that page, or shows your fallback for `none`.

If there's no provider, or it fails or takes longer than 6 seconds, Wayfinder matches words instead. The visitor always gets an answer.

You can also set a **threshold**. If Jev is less sure than that, the box shows up to 3 likely pages ("Did you mean one of these?") instead of guessing.

## Your pages

Each page is `{ href, title, about }`:

```ts
{ href: "/hours", title: "Opening hours", about: "When each branch is open, bank holidays, directions and parking" }
```

- **`about` matters most.** Both Jev and the word matching read it. Write it the way visitors talk: "lost card", "kids", "parking", not "Membership services".
- **List the pages people look for**, not every page on the site. Somewhere between 10 and 100 works best.
- **Extra fields are fine.** They come back to you in `find()` results, but the browser only ever gets `href` and `title`.
- **To change the pages, create a new Wayfinder.** `createWayfinder` keeps its own copy of the list, and works out what it needs from it once, so searches stay fast.

## Your server

`createWayfinder()` sets everything up once:

```ts
import { createWayfinder } from "wayfinder-search";

const wayfinder = createWayfinder({
  pages,
  apiKey: process.env.OPENROUTER_API_KEY,
  site: "Fernhollow Library, a public library",
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `pages` | required | Your pages, as above. |
| `apiKey` | none | Your OpenRouter key. Without it (or `provider`), word matching is used. |
| `model` | `typesafe/jev-1.14` | Which OpenRouter decision model to use. |
| `provider` | none | Any other [provider](#providers), instead of `apiKey`. |
| `site` | none | Your site's name and what it is. It helps Jev understand the question. |
| `threshold` | none | How sure (0 to 1) Jev must be. Below it, visitors get a few likely pages to pick from. |
| `unsureLimit` | `3` | How many pages to offer when unsure. |
| `timeoutMs` | `6000` | How long to wait for Jev to pick a page before matching words instead. |
| `suggestions` | on | Settings for [suggestions](#suggestions-while-typing): `{ minScore, limit, timeoutMs }` (suggestions wait 3 seconds by default), or `false` to turn them off. |
| `instructions` | a sensible question | The question Jev is asked, if you want to word it yourself. |
| `noneMeans` | "No page on the site helps with this…" | What `none` means to Jev. |
| `maxQueryLength` | `200` | Longer searches are cut to this length. |
| `onFallback` | none | Called with an error whenever Jev fails and word matching answers. The error never includes the search. |

It gives you:

- **`wayfinder.handle(request)`**: the endpoint, for anything that uses Web `Request` and `Response`.
- **`wayfinder.node(req, res)`**: the same endpoint, for Express and Node's own `http` server.
- **`wayfinder.answer(body)`**: for anything else. Give it the parsed JSON body, and get back `{ status, body }` to send as JSON.
- **`wayfinder.find(query)`** and **`wayfinder.suggest(query)`**: for calling Wayfinder from your own code.

### Next.js, Remix, SvelteKit, Astro

```ts
export const POST = wayfinder.handle;
```

### Hono, Bun, Deno, Cloudflare Workers

```ts
app.post("/api/search", (c) => wayfinder.handle(c.req.raw)); // Hono
Bun.serve({ fetch: (request) => wayfinder.handle(request) }); // Bun
Deno.serve((request) => wayfinder.handle(request));           // Deno
export default { fetch: (request) => wayfinder.handle(request) }; // Workers
```

### Express

```ts
app.post("/api/search", wayfinder.node);
```

It works with or without `express.json()`.

### Node's own `http`

```ts
createServer((req, res) => {
  if (req.url === "/api/search") return wayfinder.node(req, res);
  // ...the rest of your site
});
```

The demo does this, in [`examples/demo/server.ts`](../examples/demo/server.ts).

### What the endpoint expects

| Request body | Response |
| --- | --- |
| `{ "query": "lost my card" }` | `{ "kind": "page", "page": { "href", "title" }, "confidence"? }`, `{ "kind": "unsure", "pages": [...] }` or `{ "kind": "none" }` |
| `{ "query": "lost my", "suggest": true }` | `{ "suggestions": [{ "page": { "href", "title" }, "score": 0.92 }] }` |

Requests must be `POST` with `Content-Type: application/json`. Otherwise they get a `405` or a `415`. That also stops other websites from using your endpoint from their pages without the browser asking first. Bad requests get a `400`, and bodies over 4 KB get a `413` (Wayfinder stops reading at 4 KB). Responses are never cached.

## The search box

```js
import "wayfinder-search/element";
```

```html
<wayfinder-search endpoint="/api/search" suggest label="Search the library">
  <p slot="none">Nothing here covers that. <a href="/contact">Ask us</a>.</p>
</wayfinder-search>
```

### Attributes

| Attribute | Default | What it does |
| --- | --- | --- |
| `endpoint` | required | Your search endpoint. |
| `suggest` | off | Show matching pages while people type. |
| `suggest-cooldown` | `2000` | The least time between two suggestion requests, in milliseconds. |
| `label` | "Search this site" | The name screen readers announce for the box. |
| `placeholder` | "What are you looking for?" | The grey text in the empty box. |
| `none-label` | "Nothing on the site fits that." | Shown when no page fits, above your `none` slot. |
| `unsure-label` | "Did you mean one of these?" | Shown above the likely pages. |
| `error-label` | "Search isn't working right now…" | Shown if the endpoint fails. |
| `searching` | "Searching…" | Announced while searching. |
| `suggestions-label` | "Suggested pages" | The name screen readers announce for the suggestions. |
| `button-label` | "Search" | The name screen readers announce for the button. |
| `match-label` | "match" | Read out after each score ("92% match"). |
| `count-label` | "{n} found" | Announced with the number of suggestions or pages. |
| `hide-scores` | off | Hide the "92%" next to each suggestion. |
| `unstyled` | off | Drop the built-in look, keeping only what's needed for it to work. |

### Slot

- **`none`**: what to show when no page fits, such as a phone number, contact link or chat button.

### Routing yourself

Before going to a page, the box fires a `wayfinder-navigate` event with the page as `event.detail`. Cancel it to use your own router:

```js
box.addEventListener("wayfinder-navigate", (event) => {
  event.preventDefault();
  router.push(event.detail.href);
});
```

### Styling

The quickest way is with CSS variables:

| Variable | What it colours |
| --- | --- |
| `--wayfinder-accent` | The button, focus ring, links and highlights |
| `--wayfinder-on-accent` | The icon on the button |
| `--wayfinder-bg` | The box and pop-ups |
| `--wayfinder-fg` | The text |
| `--wayfinder-border` | Borders |
| `--wayfinder-radius` | The box's corners |

For more control, style its parts with `::part()`: `form`, `label`, `field`, `input`, `button`, `suggestions`, `suggestion`, `suggestion-title`, `score`, `panel` and `option` (the links in an "unsure" answer).

```css
wayfinder-search::part(input) { font-size: 1.125rem; }
wayfinder-search::part(suggestions) { border-radius: 0; }
```

Add `unstyled` to start from a blank slate.

### Keyboard and screen readers

- The box is a labelled `role="search"` form. With `suggest`, it's a combobox with a list of options.
- **↓ / ↑** move through suggestions (or the pages of an "unsure" answer). **Enter** goes to the highlighted one, or searches if none is highlighted. **Escape**, clicking elsewhere or tabbing away closes whatever is open.
- Every word the box says can be changed with the attributes above, so it can be translated.
- Searching, results and the number of suggestions are announced.

## Suggestions while typing

With `suggest`, the box lists pages that fit what's being typed, each with a match score:

- **With Jev**, each page gets its own yes-or-no question ("would this page answer it?"), so several pages can score highly at once. All the questions go in one request.
- **Without Jev**, the score is the share of the typed words found on the page. An unfinished last word counts if it starts a word on the page, so "prin" matches "printing".

Only pages scoring **0.7 or more** are shown, at most 5. The two kinds of score aren't quite the same scale, so if you mostly run without Jev, you may want a lower `minScore`. Change it on the server:

```ts
createWayfinder({ pages, apiKey, suggestions: { minScore: 0.6, limit: 8 } });
```

### Keeping the bill down

Each list of suggestions from Jev is one API request, so the box:

1. waits for a 300 ms pause in typing,
2. waits at least `suggest-cooldown` (2 s by default) between requests,
3. needs at least 3 characters, and
4. remembers answers it already has, so backspacing is free.

The cooldown runs in the visitor's browser, so someone calling your endpoint directly could ignore it. Each suggestion request asks one question per page, so it costs more than a search. If that worries you, add a rate limit to your endpoint (your host or framework usually has one), or turn suggestions off on the server with `suggestions: false`.

## Build your own search box

`wayfinder-search/client` is everything the search box does, without the box: it talks to your endpoint, keeps the cooldown and tracks what to show. You draw it however you like.

```js
import { createSearch } from "wayfinder-search/client";

const search = createSearch({ endpoint: "/api/search", suggest: true });
```

| Option | Default | What it does |
| --- | --- | --- |
| `endpoint` | required | Your search endpoint. |
| `suggest` | `false` | Fetch suggestions while typing. |
| `cooldownMs` | `2000` | The least time between suggestion requests. |
| `pauseMs` | `300` | How long typing must pause before suggestions are fetched. |
| `minLength` | `3` | Characters needed before suggestions are fetched. |
| `timeoutMs` | `10000` | How long to wait for the endpoint. |
| `navigate` | `location.assign` | How to go to a page. Pass your router here. |

What you get back:

| | What it does |
| --- | --- |
| `search.type(text)` | Call on every change to the input. |
| `search.submit(text)` | Call when the form is submitted. |
| `search.go(page)` | Go to a suggestion, or one of the pages of an "unsure" answer. |
| `search.dismiss()` | Hide answers and suggestions, on Escape for example. |
| `search.subscribe(fn)` | `fn(state)` runs on every change. It returns a function that stops it. |
| `search.state` | The current state (see below). |
| `search.destroy()` | Stop everything, when the box goes away. |

`state` is:

```ts
{
  status: "idle" | "searching" | "none" | "unsure" | "error",
  pages: { href, title }[],                               // When status is "unsure".
  suggestions: { page: { href, title }, score: number }[], // Best first.
}
```

### React

```tsx
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createSearch } from "wayfinder-search/client";

export function Search() {
  const router = useRouter();
  const search = useMemo(
    () => createSearch({ endpoint: "/api/search", suggest: true, navigate: (page) => router.push(page.href) }),
    [router],
  );
  useEffect(() => () => search.destroy(), [search]);
  const state = useSyncExternalStore(search.subscribe, () => search.state, () => search.state);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        search.submit(String(new FormData(event.currentTarget).get("q")));
      }}
    >
      <input name="q" aria-label="Search" onChange={(event) => search.type(event.target.value)} />
      <ul>
        {state.suggestions.map(({ page, score }) => (
          <li key={page.href}>
            <button type="button" onClick={() => search.go(page)}>
              {page.title} ({Math.round(score * 100)}%)
            </button>
          </li>
        ))}
      </ul>
      {state.status === "none" && <p>Nothing fits. <a href="/contact">Ask us</a>.</p>}
    </form>
  );
}
```

The demo also has a plain JavaScript version at `/build-your-own`.

## Providers

A provider is whatever picks the pages. Jev, through OpenRouter, is built in:

```ts
import { openRouter } from "wayfinder-search";
const provider = openRouter({ apiKey, model: "typesafe/jev-1.14" });
```

`createWayfinder({ apiKey })` does this for you.

To use something else, such as another AI or embeddings, write an object with these methods:

```ts
interface Provider {
  // Required: pick one of choice.options (or "none").
  choose(choice, { signal }): Promise<{ choice: string; confidence?: number; probabilities?: Record<string, number> }>;
  // Optional, for suggestions: score each option from 0 to 1, each on its own.
  score?(choice, { signal }): Promise<Record<string, number>>;
}
```

`choice` is `{ state, instructions, options }`. `state` holds the search (`{ site?, visitor_search }`), and `options` maps short names like `"opening-hours"` to `"Opening hours: When each branch is open…"`.

- Throw if anything goes wrong, and Wayfinder matches words instead. Keep the search out of your error messages: they go to `onFallback`, which people may log.
- Stop work when `signal` aborts. Wayfinder stops waiting either way.
- You don't have to check the answer. Wayfinder ignores any choice that isn't one of the options.
- With no `score` method, suggestions use word matching.

## Lower-level functions

`createWayfinder()` is built from these, if you need them on their own:

- `findPage(query, pages, options)`: the one page, with the same options as `createWayfinder` plus `provider` and `signal`.
- `suggestPages(query, pages, options)`: scored suggestions, with `provider`, `minScore`, `limit`, `timeoutMs`, `site`, `signal`, `onFallback`.
- `matchPage`, `rankPages` and `scorePages`: word matching only.
- `optionNames(pages)`: the short names pages get as options.

## Privacy and security

- **Searches are never logged or stored** by Wayfinder, and the built-in provider's errors never contain them.
- **Requests to OpenRouter ask for no data collection** (`data_collection: "deny"`), so they only go to providers that don't keep or train on them.
- **The API key stays on your server.** `openRouter()` refuses to run in a browser.
- **Visitors can't be sent off your site.** A pick that isn't one of your pages is ignored, and the search box only follows `http` and `https` links.
- **The browser only learns each page's `href` and `title`.**

## Limits

- **10 to 100 pages.** Every description goes into every request. Past about a hundred, requests get slower and pricier, and choosing gets harder.
- **One answer per search.** Wayfinder is for "take me there", not for browsing results.
- **Word matching is English-flavoured and basic.** It's a safety net.

## Working on Wayfinder

```bash
pnpm install
pnpm test        # Run the tests
pnpm typecheck   # Check the types
pnpm build       # Build dist/
pnpm demo        # Build, then run the demo on http://localhost:3000
```

The library runs on Node 20.3 or later. The demo runs TypeScript directly, so it needs Node 22.18 or later.
