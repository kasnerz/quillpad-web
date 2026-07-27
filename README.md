# quillpad-web

A Google Keep-style web UI for the notes that the
[Quillpad](https://github.com/quillpad/quillpad) Android app syncs to a
self-hosted [quillnote-server](https://github.com/kasnerz/quillnote-server) —
a small Nextcloud Notes API emulator.

Coloured rounded cards in a masonry grid, drag to reorder, pinning, archive,
checkbox and plain notes, markdown or plaintext, live updates over SSE, and no
login screen.

Plain HTML, CSS and ES modules: no build step, no framework, no npm install.
Two dependencies are vendored as files. Any static web server can host it.

## Layout

```
compose.yaml   caddy:2-alpine serving ./public on :80
Caddyfile      static file server + SPA fallback to index.html
public/        the app itself
  index.html
  style.css
  js/api.js        fetch wrappers, X-Client-Id, modified stamping, SSE subscription
  js/store.js      in-memory notes, optimistic writes with rollback
  js/layout.js     JS masonry + pointer-events drag & drop
  js/card.js       card rendering, inline checkbox ticking, per-card actions
  js/editor.js     editor overlay, debounced autosave
  js/checklist.js  the `- [ ] item` format Quillpad reads and writes
  js/palette.js    the twelve note colours
  js/markdown.js   marked + DOMPurify
  vendor/          marked 12.0.2, DOMPurify 3.1.6
```

## What it expects from the server

The stock Nextcloud Notes endpoints, same-origin:

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/index.php/apps/notes/api/v1/notes/` | load all notes |
| `POST` | `/index.php/apps/notes/api/v1/notes/` | create |
| `PUT` | `/index.php/apps/notes/api/v1/notes/{id}` | partial update (patch semantics, not replace) |
| `DELETE` | `/index.php/apps/notes/api/v1/notes/{id}` | delete |

Plus two endpoints that are **not** part of the Notes API:

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/web/v1/events` | SSE stream, one event per create/update/delete/reorder |
| `PUT` | `/web/v1/order` | `{"ids": [...]}` — the full manual ordering in one write |

and four extra fields carried alongside the standard `id`, `title`, `content`,
`favorite`, `modified`:

`color`, `archived`, `position`, `markdown`, `noteType`

These are web-only state. Quillpad parses its responses with
`ignoreUnknownKeys = true`, so the extra fields ride along on the ordinary
endpoints without upsetting the phone.

Every write carries a `X-Client-Id` header, echoed back as `origin` on the SSE
event it causes, so a client can ignore the echo of its own change and not
re-render the grid out from under someone who is typing.

Upstream [arunk140/quillnote-server](https://github.com/arunk140/quillnote-server)
implements none of that, so this app needs the fork that does:
**[kasnerz/quillnote-server](https://github.com/kasnerz/quillnote-server)**. It
speaks the same Nextcloud Notes API to the phone, so Quillpad syncs against it
unchanged.

## Running it

You need three pieces: this app, [the server
fork](https://github.com/kasnerz/quillnote-server), and a reverse proxy that
puts them on one origin.

`docker compose up -d` serves `public/` on port 80 of the `quillpad-web`
container. There is no published port by design — see below. Point it wherever
you like, or skip Docker entirely and hand `public/` to any static server.

The one hard requirement is that **the notes API and the app must be same-origin**.
The app uses absolute paths (`/index.php/...`, `/web/...`), never a configured
base URL, so a reverse proxy in front has to split traffic by path:

| Path | Goes to |
| --- | --- |
| `/index.php/apps/notes/api/*` | the notes server |
| `/ocs/*` | the notes server |
| `/web/*` | the notes server (disable response buffering, or SSE stalls) |
| everything else | this app |

No CORS, no separate hostname, no credentials in the browser.

## No login screen

The app holds no credentials at all and sends no `Authorization` header. The
intended deployment has the reverse proxy add one for requests that arrive
without it — Quillpad always sends its own, so the phone falls through to an
untouched proxy and syncs as usual.

**This is only safe on a private network** (a tailnet, a VPN, a LAN). On a
publicly reachable host that proxy rule hands every anonymous visitor a
logged-in session, so it has to go before you expose anything — and then the app
needs a real auth story, which it does not have today.

## What syncs to the phone, and what does not

Quillpad maps its notes onto the Nextcloud Notes API in
`data/sync/nextcloud/model/NextcloudConverters.kt`, and that mapping is narrow:

| Feature | Round-trips to the phone? | How |
| --- | --- | --- |
| title, content | yes | native fields |
| **pinned** | **yes** | `favorite` ↔ `Note.isPinned` |
| **checkboxes** | **yes, as text** | stored as `- [ ] item` / `- [x] item`, exactly Quillpad's `taskListToMd()` format |
| colour, archive, manual order | no | no field exists in the API — web-only, kept in extra columns on the server |
| markdown vs plaintext | no | Quillpad forces `isMarkdownEnabled = true` on everything it pulls |
| category / notebooks | **never use it** | Quillpad hardcodes `category = ""` on every push, so anything stored there is wiped on the next sync |

One more property this design leans on: every write sends `modified` (epoch
**seconds**). Quillpad resolves conflicts by last-modified-wins with a ±1s
tolerance, so a note without it loses to the phone every time.

## How fast "instant" actually is

Server-to-browser is immediate: the server publishes an SSE event on every
create/update/delete/reorder, whoever caused it, and the browser refetches on
receipt. Measured end to end through a reverse proxy, a phone-shaped write shows
up in an open page in **~240ms**, with no reload and no polling.

Phone-to-server is the limit, and nothing here can raise it. Quillpad pushes
only when the notes list resumes (i.e. when you back out of a note), on
swipe-to-refresh, and on a **1-hour** `PeriodicWorkRequest` hardcoded in
`App.kt`. In practice: edit a note and go back — it lands right away. Edit a
note and background the app from inside the editor — it may wait up to an hour.

If the stream drops (proxy restart, laptop asleep) the client reconnects with
exponential backoff and also refetches on focus, on tab visibility, and on a
60-second safety poll. The dot in the top right is green while the stream is
connected, amber while reconnecting.

## Working on it

`public/` is bind-mounted read-only, so editing a file there is live on the next
browser reload; no rebuild or restart needed. The app is deliberately
build-free — ES modules loaded natively, dependencies vendored in
`public/vendor/`.

```sh
docker compose restart quillpad-web   # only needed after Caddyfile changes
```

Drag-and-drop reordering writes the **whole** ordering in one
`PUT /web/v1/order`, and merges the visible order back into the full list, so
reordering while filtered by a search or inside Archive does not disturb notes
that were not on screen.

## License

GPL-3.0-or-later, matching the server it talks to. See [LICENSE](LICENSE).

Copyright (C) 2026 Zdeněk Kasner.

The vendored files in `public/vendor/` keep their own licenses: [marked](https://github.com/markedjs/marked)
is MIT, [DOMPurify](https://github.com/cure53/DOMPurify) is dual Apache-2.0 /
MPL-2.0.
