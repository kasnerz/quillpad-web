// The note editor. Saves as you type (debounced), like Keep — there is no Save
// button. A brand-new note is not created on the server until it actually has
// something in it, so opening and closing the composer leaves no empty notes
// behind (which would then sync to the phone).

import * as store from "./store.js";
import {
  parseChecklist,
  serializeChecklist,
  textToChecklist,
  checklistToText,
} from "./checklist.js";
import { openPalette, colorVar } from "./palette.js";

const SAVE_DELAY = 600;

const overlay = document.getElementById("editor-overlay");
const editorEl = document.getElementById("editor");
const titleEl = document.getElementById("editor-title");
const contentEl = document.getElementById("editor-content");
const listEl = document.getElementById("editor-list");
const addItemEl = document.getElementById("editor-add-item");

const pinBtn = document.getElementById("editor-pin");
const colorBtn = document.getElementById("editor-color");
const typeBtn = document.getElementById("editor-toggle-type");
const markdownBtn = document.getElementById("editor-markdown");
const archiveBtn = document.getElementById("editor-archive");
const deleteBtn = document.getElementById("editor-delete");
const closeBtn = document.getElementById("editor-close");

let draft = null; // the note being edited: { id, ...fields }
let saved = null; // last state known to be on the server, for diffing
let items = []; // checklist rows, when noteType === "list"
let saveTimer = null;
let onClosed = () => {};

export function isOpen() {
  return !overlay.hidden;
}

export function openNote(note, options = {}) {
  draft = {
    id: note ? note.id : null,
    title: note ? note.title || "" : "",
    content: note ? note.content || "" : "",
    color: note ? note.color || "" : "",
    favorite: note ? !!note.favorite : false,
    archived: note ? !!note.archived : false,
    markdown: note ? note.markdown !== false : true,
    noteType: note ? note.noteType || "text" : options.noteType || "text",
  };
  saved = { ...draft };
  items = draft.noteType === "list" ? parseChecklist(draft.content) : [];

  overlay.hidden = false;
  syncFromDraft();

  if (draft.noteType === "list") {
    if (!items.length) addItem("");
    else titleEl.focus();
  } else {
    (note ? contentEl : titleEl).focus();
  }
}

export function setOnClosed(fn) {
  onClosed = fn;
}

/** Pulls the whole editor UI back into agreement with `draft`. */
function syncFromDraft() {
  editorEl.style.background = colorVar(draft.color);
  titleEl.value = draft.title;

  const isList = draft.noteType === "list";
  contentEl.hidden = isList;
  listEl.hidden = !isList;
  addItemEl.hidden = !isList;
  // Markdown is meaningless for a checklist, and the phone forces markdown on
  // anything it pulls anyway.
  markdownBtn.hidden = isList;

  if (isList) {
    renderItems();
  } else {
    contentEl.value = draft.content;
    autoGrow();
  }

  pinBtn.classList.toggle("active", draft.favorite);
  pinBtn.title = draft.favorite ? "Unpin" : "Pin";
  markdownBtn.classList.toggle("active", draft.markdown);
  markdownBtn.title = draft.markdown ? "Markdown on" : "Markdown off";
  typeBtn.title = isList ? "Convert to text" : "Convert to checkboxes";
  archiveBtn.title = draft.archived ? "Unarchive" : "Archive";
  deleteBtn.hidden = !draft.id;
}

function autoGrow() {
  contentEl.style.height = "auto";
  contentEl.style.height = `${contentEl.scrollHeight}px`;
}

/* ---------------------------------------------------------------- *
 * Checklist rows                                                    *
 * ---------------------------------------------------------------- */

function renderItems() {
  listEl.innerHTML = "";
  items.forEach((item, index) => listEl.appendChild(renderItemRow(item, index)));
}

function renderItemRow(item, index) {
  const row = document.createElement("div");
  row.className = `check-row${item.done ? " done" : ""}`;

  const box = document.createElement("button");
  box.className = "check-box";
  box.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>`;
  box.addEventListener("click", () => {
    items[index].done = !items[index].done;
    renderItems();
    touchContent();
  });

  const input = document.createElement("input");
  input.className = "list-input";
  input.value = item.text;
  input.placeholder = "List item";
  input.addEventListener("input", () => {
    items[index].text = input.value;
    touchContent();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem("", index + 1);
    } else if (event.key === "Backspace" && input.value === "" && items.length > 1) {
      event.preventDefault();
      items.splice(index, 1);
      renderItems();
      touchContent();
      focusItem(Math.max(0, index - 1), "end");
    }
  });

  const remove = document.createElement("button");
  remove.className = "icon-btn";
  remove.title = "Remove item";
  remove.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  remove.addEventListener("click", () => {
    items.splice(index, 1);
    if (!items.length) addItem("");
    else renderItems();
    touchContent();
  });

  row.append(box, input, remove);
  return row;
}

function addItem(text, at = items.length) {
  items.splice(at, 0, { done: false, text });
  renderItems();
  focusItem(at);
  touchContent();
}

function focusItem(index, caret) {
  const input = listEl.children[index]?.querySelector("input");
  if (!input) return;
  input.focus();
  if (caret === "end") input.setSelectionRange(input.value.length, input.value.length);
}

function touchContent() {
  draft.content = serializeChecklist(items);
  scheduleSave();
}

/* ---------------------------------------------------------------- *
 * Saving                                                            *
 * ---------------------------------------------------------------- */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flush().catch((err) => console.error("save failed", err));
  }, SAVE_DELAY);
}

function changedFields() {
  const fields = {};
  for (const key of ["title", "content", "color", "favorite", "archived", "markdown", "noteType"]) {
    if (draft[key] !== saved[key]) fields[key] = draft[key];
  }
  return fields;
}

const isBlank = () => !draft.title.trim() && !draft.content.trim();

export async function flush() {
  clearTimeout(saveTimer);
  if (!draft) return;

  if (!draft.id) {
    // Nothing worth persisting yet — an empty note would sync to the phone.
    if (isBlank()) return;
    const created = await store.create({
      title: draft.title,
      content: draft.content,
      color: draft.color,
      favorite: draft.favorite,
      archived: draft.archived,
      markdown: draft.markdown,
      noteType: draft.noteType,
    });
    draft.id = created.id;
    saved = { ...draft };
    deleteBtn.hidden = false;
    return;
  }

  const fields = changedFields();
  if (!Object.keys(fields).length) return;
  saved = { ...draft };
  await store.patch(draft.id, fields);
}

export async function close() {
  if (!draft) return;
  try {
    await flush();
  } catch (err) {
    console.error("save on close failed", err);
  }

  // A note emptied out completely is deleted rather than left blank, matching
  // Keep and keeping the phone's list clean.
  if (draft.id && isBlank()) {
    try {
      await store.remove(draft.id);
    } catch (err) {
      console.error("discard failed", err);
    }
  }

  overlay.hidden = true;
  draft = null;
  items = [];
  onClosed();
}

/* ---------------------------------------------------------------- *
 * Wiring                                                            *
 * ---------------------------------------------------------------- */

titleEl.addEventListener("input", () => {
  draft.title = titleEl.value;
  scheduleSave();
});

contentEl.addEventListener("input", () => {
  draft.content = contentEl.value;
  autoGrow();
  scheduleSave();
});

addItemEl.addEventListener("click", () => addItem(""));

pinBtn.addEventListener("click", () => {
  draft.favorite = !draft.favorite;
  syncFromDraft();
  scheduleSave();
});

colorBtn.addEventListener("click", () => {
  openPalette(colorBtn, draft.color || "Default", (color) => {
    draft.color = color === "Default" ? "" : color;
    syncFromDraft();
    scheduleSave();
  });
});

markdownBtn.addEventListener("click", () => {
  draft.markdown = !draft.markdown;
  syncFromDraft();
  scheduleSave();
});

typeBtn.addEventListener("click", () => {
  if (draft.noteType === "list") {
    draft.noteType = "text";
    draft.content = checklistToText(items);
    items = [];
  } else {
    draft.noteType = "list";
    items = textToChecklist(draft.content);
    if (!items.length) items = [{ done: false, text: "" }];
    draft.content = serializeChecklist(items);
  }
  syncFromDraft();
  scheduleSave();
});

archiveBtn.addEventListener("click", async () => {
  draft.archived = !draft.archived;
  await close();
});

deleteBtn.addEventListener("click", async () => {
  if (!draft.id) return close();
  if (!confirm("Delete this note?")) return;
  const id = draft.id;
  clearTimeout(saveTimer);
  draft = null;
  overlay.hidden = true;
  await store.remove(id);
  onClosed();
});

closeBtn.addEventListener("click", () => close());

overlay.addEventListener("click", (event) => {
  if (event.target === overlay) close();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) close();
});
