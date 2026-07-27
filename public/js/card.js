// Builds one note card. Cards are rebuilt wholesale on each render (they are
// cheap, and it keeps state in exactly one place); js/layout.js then positions
// them.

import { renderMarkdown } from "./markdown.js";
import { parseChecklist, serializeChecklist } from "./checklist.js";
import { colorVar, openPalette } from "./palette.js";

const MAX_PREVIEW_ITEMS = 8;

const ICONS = {
  pin: `<svg viewBox="0 0 24 24"><path d="M15 3l6 6-3 1-4 4-1 5-6-6 5-1 4-4z"/><path d="M7 17l-4 4"/></svg>`,
  color: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16"/></svg>`,
  archive: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/></svg>`,
  unarchive: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M12 17v-5M9 14l3-3 3 3"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`,
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

  card.appendChild(renderBody(note, handlers));

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
    iconButton("trash", "Delete", () => handlers.onDelete(note.id), "danger")
  );

  card.appendChild(actions);

  card.addEventListener("click", (event) => {
    if (event.target.closest("button, input, a")) return;
    handlers.onOpen(note.id);
  });

  return card;
}

function renderBody(note, handlers) {
  if (note.noteType === "list") return renderChecklist(note, handlers);

  const body = document.createElement("div");
  body.className = "card-body";

  if (!note.content) {
    if (!note.title) {
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
    box.addEventListener("click", (event) => {
      event.stopPropagation();
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
