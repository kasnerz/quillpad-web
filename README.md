# quillpad-web

A Google Keep-style web UI for the notes that the
[Quillpad](https://github.com/quillpad/quillpad) Android app syncs to a
self-hosted [quillnote-server](https://github.com/kasnerz/quillnote-server) —
a small Nextcloud Notes API emulator.

Coloured rounded cards in a masonry grid, drag to reorder, pinning, archive, a
trash that keeps deleted notes for seven days, checkbox and plain notes,
markdown or plaintext, a light/dark theme, live updates over SSE, and no login
screen.

Plain HTML, CSS and ES modules: no build step, no framework, no npm install.
Two dependencies are vendored as files. Any static web server can host it.

## Layout

```
compose.yaml   caddy:2-alpine serving ./public on :80
Caddyfile      static file server + SPA fallback to index.html
public/        the app itself
  index.html
  style.css
  icon.svg         Quillpad's logo — favicon and the mark in the top bar
  icon-512.png     the same, as an apple-touch-icon
  js/api.js        fetch wrappers, X-Client-Id, modified stamping, SSE subscription
  js/store.js      in-memory notes and trash, optimistic writes with rollback
  js/layout.js     JS masonry + pointer-events drag & drop
  js/card.js       card rendering, inline checkbox ticking, per-card actions
  js/editor.js     editor overlay, debounced autosave
  js/checklist.js  the `- [ ] item` format Quillpad reads and writes
  js/palette.js    the twelve note colours
  js/zoom.js       reads back the interface scale, for the pointer maths
  js/theme.js      the light/dark switch in the top bar, remembered per browser
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
| `DELETE` | `/index.php/apps/notes/api/v1/notes/{id}` | **permanent** delete — "delete forever" |

The listing must withhold trashed notes; see [The trash](#the-trash) below.

Plus seven endpoints that are **not** part of the Notes API:

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/web/v1/events` | SSE stream, one event per create/update/delete/reorder/purge |
| `PUT` | `/web/v1/order` | `{"ids": [...]}` — the full manual ordering in one write |
| `GET` | `/web/v1/trash` | the trashed notes, most recently thrown away first |
| `DELETE` | `/web/v1/trash` | empty the trash |
| `POST` | `/web/v1/attachments` | store a file — the raw bytes are the entire body |
| `HEAD` | `/web/v1/attachments/{hash}` | is this file already stored? |
| `GET` | `/web/v1/attachments/{hash}` | the bytes, for an `<img>` to point at |

and seven extra fields carried alongside the standard `id`, `title`, `content`,
`favorite`, `modified`:

`color`, `archived`, `position`, `markdown`, `noteType`, `deleted`,
`attachments`

The first six are web-only state. Quillpad parses its responses with
`ignoreUnknownKeys = true`, so they ride along on the ordinary endpoints without
upsetting the phone. `attachments` is the exception — the phone reads and writes
it too; see [Images](#images).

Every write carries a `X-Client-Id` header, echoed back as `origin` on the SSE
event it causes, so a client can ignore the echo of its own change and not
re-render the grid out from under someone who is typing.

Upstream [arunk140/quillnote-server](https://github.com/arunk140/quillnote-server)
implements none of that, so this app needs the fork that does:
**[kasnerz/quillnote-server](https://github.com/kasnerz/quillnote-server)**. It
speaks the same Nextcloud Notes API to the phone, so Quillpad syncs against it
unchanged.

## The trash

Deleting a note never asks and never destroys anything: it sets `deleted` to the
current epoch second, which moves the note out of the notes list and into the
Trash view, with an *Undo* in the toast. It can be restored from there for seven
days; after that the server destroys it. Both halves of that deadline are one
constant each — `TRASH_RETENTION_DAYS` in `js/card.js`, which only renders the
countdown, and `TrashRetention` in the server's `trash.go`, which enforces it.

A trashed note is left out of `GET /notes/` even though the row survives, so the
phone drops its copy immediately — from Quillpad's side a trashed note looks
exactly like a deleted one, which is the point: the seven days are a safety net
on this side, not a delay before the deletion syncs.

The two irreversible actions — *Delete forever* on a card in the trash, and
*Empty trash* — are the only ones that still ask for confirmation. A `DELETE` on
the Notes API endpoint is one of those: it destroys the note outright. Quillpad
only sends `DELETE` for a note that has already been through its own on-device
trash, so a note deleted on the phone does not reappear here.

## Images

A note can carry images, and they sync both ways with the phone. Add them with
the image button in the editor, by pasting a screenshot, or by dropping files
onto it; hover a thumbnail to remove one. Cards show up to four, with a `+N`
badge past that.

The bytes live in the server's blob store, addressed by the **sha256 of their
content**, and the note carries only a list of references:

```json
"attachments": [
  { "hash": "…", "type": "IMAGE", "mime": "image/jpeg", "name": "IMG_2043.jpg", "description": "" }
]
```

That indirection is what makes the sync cheap. The same image on two notes is
uploaded and stored once; `GET /web/v1/attachments/{hash}` is served with
`Cache-Control: immutable`, since a given URL's bytes can never change, so the
grid never refetches an image it has already seen.

Removing an image from a note removes only the reference — the bytes stay until
the server's sweep finds no note pointing at them, so it can never break the
same image on another note.

Uploads are the one write that is not optimistic: a placeholder tile pulses in
the editor until the hash comes back, because there is nothing to show until the
server has the file. The server accepts `image/*` only, and the phone downscales
before uploading (see below).

## The theme

The button beside the search flips the scheme on the spot; the icon shows which
way it leads. Until it is first clicked the page follows the OS, and keeps
following it, so a machine that dims itself at sunset dims the page with it. The
first click ends that and pins an explicit choice.

That choice is stored in `localStorage` under `quillpad-theme` — per browser, not
per note and not on the server, so it never touches the sync path or the phone.
Clearing it goes back to following the OS.

The whole palette is CSS custom properties in `style.css`, one light set on
`:root` and one dark set under `:root[data-theme="dark"]`, including the twelve
note colours. `js/theme.js` resolves the choice down to that attribute; keying
off it rather than a `prefers-color-scheme` media query is what lets an explicit
choice win against the OS. A small inline script in `index.html` sets the same
attribute before the first paint, since a module would otherwise run late enough
to let a dark page flash white.

## Interface scale

The whole interface renders at `--ui-zoom` in `style.css`, currently `1.1` —
what a browser shows at 110% zoom. It is applied as CSS `zoom` on `<body>`, which
reflows: text rewraps and the masonry recounts its columns, where
`transform: scale()` would only magnify a layout built for a smaller window.
Every length in the stylesheet is in px, so that one number moves all of them.

It comes with one trap, which is what `js/zoom.js` is for. `zoom` splits two
coordinate systems: `getBoundingClientRect` and pointer events report *client*
px including the zoom, while `offsetWidth`, `clientWidth` and any `left`/`top`
written back are in the zoomed element's *own* px. Drag-to-reorder and the
colour palette both mix the two, so they divide the zoom back out. The factor is
measured off `document.body` rather than read from the CSS, so it cannot drift
from `--ui-zoom` and is exactly `1` when there is no zoom.

The one thing that does not scale by itself is the `max-width` on the mobile
breakpoint: media queries match the real viewport, which sits outside the zoomed
subtree, so that number is pre-multiplied in the stylesheet.

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
| **images** | **yes** | the `attachments` list plus the blob store; the phone uploads a downscaled copy and downloads anything it does not have. Audio, video and other files stay on the phone |
| colour, archive, manual order | no | no field exists in the API — web-only, kept in extra columns on the server |
| **trash** | **one way** | a trashed note leaves the listing, so the phone deletes its copy; restoring brings it back as a new note there |
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

A note created without a `position` — from the composer, or synced across from
the phone — is placed at the **front** of that order rather than the end, so
something just written is not buried under everything older.

## License

GPL-3.0-or-later, matching the server it talks to. See [LICENSE](LICENSE).

Copyright (C) 2026 Zdeněk Kasner.

The vendored files in `public/vendor/` keep their own licenses: [marked](https://github.com/markedjs/marked)
is MIT, [DOMPurify](https://github.com/cure53/DOMPurify) is dual Apache-2.0 /
MPL-2.0.

`public/icon.svg` and `public/icon-512.png` are Quillpad's own logo, taken from
[quillpad/quillpad](https://github.com/quillpad/quillpad) (`graphics/quillpad-icon.svg`
and `fastlane/metadata/android/en-US/images/icon.png`), which is GPL-3.0 as well.
This is an unofficial companion, not a Quillpad project.
