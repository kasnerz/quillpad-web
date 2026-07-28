// Builds one note card. Cards are rebuilt wholesale on each render (they are
// cheap, and it keeps state in exactly one place); js/layout.js then positions
// them.

import { renderMarkdown } from "./markdown.js";
import { parseChecklist, serializeChecklist } from "./checklist.js";
import { colorVar, openPalette } from "./palette.js";
import { attachmentUrl } from "./api.js";

const MAX_PREVIEW_ITEMS = 8;

// Beyond this the card turns into a contact sheet and stops being readable; the
// rest are counted in a "+N" tile that opens the note like any other click.
const MAX_PREVIEW_IMAGES = 4;

// Must match TrashRetention in the server's trash.go — the countdown shown on a
// trashed card is only a rendering of the deadline the server enforces.
const TRASH_RETENTION_DAYS = 7;
const DAY_SECONDS = 86400;

const ICONS = {
  pin: `<svg viewBox="0 0 24 24"><path d="M15 3l6 6-3 1-4 4-1 5-6-6 5-1 4-4z"/><path d="M7 17l-4 4"/></svg>`,
  color: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16"/></svg>`,
  archive: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/></svg>`,
  unarchive: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M12 17v-5M9 14l3-3 3 3"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`,
  restore: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 108-8 8 8 0 00-5.7 2.4L4 9"/><path d="M4 4v5h5"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>`,
};

function iconButton(name, title, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.className = `icon-btn ${extraClass}`.trim();
  button.title = title;
  button.innerHTML = ICONS[name];
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

export function renderCard(note, handlers) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = String(note.id);
  card.style.background = colorVar(note.color);
  if (note.favorite) card.classList.add("pinned");

  if (note.title) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = note.title;
    card.appendChild(title);
  }

  const images = renderImages(note);
  // Above the title, as in Keep and in Quillpad's own note preview.
  if (images) card.insertBefore(images, card.firstChild);

  card.appendChild(renderBody(note, handlers));

  // A trashed note is on its way out: it cannot be edited, pinned or recoloured,
  // only put back or finished off. Its actions stay visible rather than
  // appearing on hover, since they are the only thing the card is for.
  if (note.deleted) {
    card.classList.add("trashed");

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = retentionLabel(note.deleted);
    card.appendChild(meta);

    const binActions = document.createElement("div");
    binActions.className = "card-actions";
    binActions.append(
      iconButton("restore", "Restore", () => handlers.onRestore(note.id)),
      iconButton("trash", "Delete forever", () => handlers.onDestroy(note.id), "danger")
    );
    card.appendChild(binActions);
    return card;
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  actions.appendChild(
    iconButton(
      "pin",
      note.favorite ? "Unpin" : "Pin",
      () => handlers.onPatch(note.id, { favorite: !note.favorite }),
      `card-pin ${note.favorite ? "active" : ""}`
    )
  );

  actions.appendChild(
    iconButton("color", "Colour", (event) =>
      openPalette(event.currentTarget, note.color, (color) =>
        handlers.onPatch(note.id, { color: color === "Default" ? "" : color })
      )
    )
  );

  actions.appendChild(
    iconButton(note.archived ? "unarchive" : "archive", note.archived ? "Unarchive" : "Archive", () =>
      handlers.onPatch(note.id, { archived: !note.archived })
    )
  );

  actions.appendChild(
    iconButton("trash", "Move to trash", () => handlers.onDelete(note.id), "danger")
  );

  card.appendChild(actions);

  card.addEventListener("click", (event) => {
    if (event.target.closest("button, input, a")) return;
    handlers.onOpen(note.id);
  });

  return card;
}

/** The image strip at the top of a card, or null when there is nothing to show. */
function renderImages(note) {
  const images = (note.attachments || []).filter(
    (attachment) => attachment.type === "IMAGE" || (attachment.mime || "").startsWith("image/")
  );
  if (!images.length) return null;

  const wrap = document.createElement("div");
  // The count drives the layout: one image spans the card, several tile.
  wrap.className = `card-images count-${Math.min(images.length, MAX_PREVIEW_IMAGES)}`;

  for (const attachment of images.slice(0, MAX_PREVIEW_IMAGES)) {
    const img = document.createElement("img");
    img.src = attachmentUrl(attachment.hash);
    img.alt = attachment.description || attachment.name || "";
    // Off-screen cards are the common case in a long grid, and the bytes are
    // immutable and cached, so the browser only ever fetches each one once.
    img.loading = "lazy";
    // Native image dragging would otherwise steal the pointer sequence that
    // drag-to-reorder is built on.
    img.draggable = false;
    wrap.appendChild(img);
  }

  if (images.length > MAX_PREVIEW_IMAGES) {
    const more = document.createElement("div");
    more.className = "card-images-more";
    more.textContent = `+${images.length - MAX_PREVIEW_IMAGES}`;
    wrap.appendChild(more);
  }

  return wrap;
}

/** "Deletes in 5 days" — how long is left of the retention window. */
function retentionLabel(deleted) {
  const expires = deleted + TRASH_RETENTION_DAYS * DAY_SECONDS;
  const days = Math.ceil((expires - Date.now() / 1000) / DAY_SECONDS);
  if (days <= 0) return "Deletes any moment now";
  if (days === 1) return "Deletes within a day";
  return `Deletes in ${days} days`;
}

function renderBody(note, handlers) {
  if (note.noteType === "list") return renderChecklist(note, handlers);

  const body = document.createElement("div");
  body.className = "card-body";

  if (!note.content) {
    // An image on its own is a perfectly good note, so it is not "empty".
    if (!note.title && !(note.attachments || []).length) {
      body.className = "card-body card-empty";
      body.textContent = "Empty note";
    }
    return body;
  }

  if (note.markdown === false) {
    body.classList.add("plain");
    body.textContent = note.content;
  } else {
    body.innerHTML = renderMarkdown(note.content);
  }
  return body;
}

function renderChecklist(note, handlers) {
  const wrap = document.createElement("div");
  wrap.className = "card-body";

  const items = parseChecklist(note.content);
  if (!items.length && !note.title) {
    wrap.className = "card-body card-empty";
    wrap.textContent = "Empty list";
    return wrap;
  }

  // Done items sink below open ones, as in Keep, without touching stored order.
  const ordered = [
    ...items.map((item, index) => ({ item, index })).filter((e) => !e.item.done),
    ...items.map((item, index) => ({ item, index })).filter((e) => e.item.done),
  ];

  for (const { item, index } of ordered.slice(0, MAX_PREVIEW_ITEMS)) {
    const row = document.createElement("div");
    row.className = `check-row${item.done ? " done" : ""}`;

    const box = document.createElement("button");
    box.className = "check-box";
    box.innerHTML = ICONS.check;
    box.title = item.done ? "Mark as not done" : "Mark as done";
    // Nothing in the trash is editable, so there the boxes are to read, not tick.
    box.disabled = !!note.deleted;
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      if (note.deleted) return;
      // Ticking straight from the card, the way Keep does, rather than making
      // the user open the note first.
      const next = parseChecklist(note.content);
      next[index].done = !next[index].done;
      handlers.onPatch(note.id, { content: serializeChecklist(next) });
    });

    const text = document.createElement("span");
    text.className = "check-text";
    text.textContent = item.text;

    row.append(box, text);
    wrap.appendChild(row);
  }

  if (ordered.length > MAX_PREVIEW_ITEMS) {
    const more = document.createElement("div");
    more.className = "check-more";
    more.textContent = `+ ${ordered.length - MAX_PREVIEW_ITEMS} more`;
    wrap.appendChild(more);
  }

  return wrap;
}
