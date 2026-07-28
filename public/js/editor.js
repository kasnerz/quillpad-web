// The note editor. Saves as you type (debounced), like Keep — there is no Save
// button. A brand-new note is not created on the server until it actually has
// something in it, so opening and closing the composer leaves no empty notes
// behind (which would then sync to the phone).

import * as store from "./store.js";
import { attachmentUrl, uploadAttachment } from "./api.js";
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
const attachmentsEl = document.getElementById("editor-attachments");

const pinBtn = document.getElementById("editor-pin");
const colorBtn = document.getElementById("editor-color");
const typeBtn = document.getElementById("editor-toggle-type");
const markdownBtn = document.getElementById("editor-markdown");
const imageBtn = document.getElementById("editor-image");
const fileEl = document.getElementById("editor-file");
const archiveBtn = document.getElementById("editor-archive");
const deleteBtn = document.getElementById("editor-delete");
const closeBtn = document.getElementById("editor-close");

let draft = null; // the note being edited: { id, ...fields }
let saved = null; // last state known to be on the server, for diffing
let items = []; // checklist rows, when noteType === "list"
// Uploads still in flight, as { name } — rendered as placeholder tiles so the
// editor shows something the moment a file is dropped rather than after the
// round trip.
let uploading = [];
let saveTimer = null;
let onClosed = () => {};
let onTrashed = () => {};
let onError = () => {};

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
    attachments: note && Array.isArray(note.attachments) ? [...note.attachments] : [],
  };
  saved = snapshot();
  items = draft.noteType === "list" ? parseChecklist(draft.content) : [];
  uploading = [];

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

/** Called with the note's id when the delete button sends it to the trash, so
 *  the app can offer the same undo it offers for a delete from a card. */
export function setOnTrashed(fn) {
  onTrashed = fn;
}

/** Called with a message when an upload fails; the app shows it as a toast. */
export function setOnError(fn) {
  onError = fn;
}

/** Pulls the whole editor UI back into agreement with `draft`. */
function syncFromDraft() {
  editorEl.style.background = colorVar(draft.color);
  titleEl.value = draft.title;
  renderAttachments();

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
 * Attachments                                                       *
 * ---------------------------------------------------------------- */

function renderAttachments() {
  attachmentsEl.innerHTML = "";
  attachmentsEl.hidden = !draft.attachments.length && !uploading.length;
  if (attachmentsEl.hidden) return;

  draft.attachments.forEach((attachment, index) => {
    const tile = document.createElement("div");
    tile.className = "attachment";

    // Only images are ever stored today, but the type is what the phone put
    // there, so anything else gets a plain link rather than a broken <img>.
    if (attachment.type === "IMAGE" || (attachment.mime || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = attachmentUrl(attachment.hash);
      img.alt = attachment.description || attachment.name || "";
      img.loading = "lazy";
      tile.appendChild(img);
    } else {
      const link = document.createElement("a");
      link.className = "attachment-file";
      link.href = attachmentUrl(attachment.hash);
      link.textContent = attachment.name || "File";
      link.download = attachment.name || "";
      tile.appendChild(link);
    }

    const remove = document.createElement("button");
    remove.className = "attachment-remove";
    remove.title = "Remove image";
    remove.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
    remove.addEventListener("click", () => {
      // Only the reference goes. The bytes stay in the blob store until the
      // server's sweep finds nothing pointing at them, so removing an image
      // from one note never breaks it on another.
      draft.attachments.splice(index, 1);
      renderAttachments();
      scheduleSave();
    });
    tile.appendChild(remove);

    attachmentsEl.appendChild(tile);
  });

  for (const pending of uploading) {
    const tile = document.createElement("div");
    tile.className = "attachment attachment-pending";
    tile.title = `Uploading ${pending.name}…`;
    attachmentsEl.appendChild(tile);
  }
}

async function addFiles(files) {
  const images = [...files].filter((file) => !file.type || file.type.startsWith("image/"));
  if (!images.length) return;

  const pending = images.map((file) => ({ name: file.name || "image" }));
  uploading.push(...pending);
  renderAttachments();

  // One at a time rather than Promise.all: a note usually gets one or two
  // images, and serialising keeps a handful of large uploads from competing for
  // the same connection.
  for (const [index, file] of images.entries()) {
    try {
      const blob = await uploadAttachment(file);
      // The editor may have been closed while this was in flight.
      if (!draft) return;
      draft.attachments.push({
        hash: blob.hash,
        type: "IMAGE",
        mime: blob.mime,
        name: file.name || `${blob.hash.slice(0, 8)}.img`,
        description: "",
      });
      scheduleSave();
    } catch (err) {
      onError(err.message);
    } finally {
      const at = uploading.indexOf(pending[index]);
      if (at >= 0) uploading.splice(at, 1);
      if (draft) renderAttachments();
    }
  }
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

// The attachment list is copied, not aliased: `saved` is compared against
// `draft` field by field, and sharing the array would make every add and remove
// invisible to changedFields().
function snapshot() {
  return { ...draft, attachments: [...draft.attachments] };
}

function changedFields() {
  const fields = {};
  for (const key of ["title", "content", "color", "favorite", "archived", "markdown", "noteType"]) {
    if (draft[key] !== saved[key]) fields[key] = draft[key];
  }
  // Compared by value. The entries are small flat objects, and the list is
  // short, so stringifying is cheaper than it looks and never wrong.
  if (JSON.stringify(draft.attachments) !== JSON.stringify(saved.attachments)) {
    fields.attachments = draft.attachments;
  }
  return fields;
}

// A note holding nothing but an image is not blank — it must not be swept into
// the trash when the editor closes.
const isBlank = () => !draft.title.trim() && !draft.content.trim() && !draft.attachments.length;

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
      attachments: draft.attachments,
    });
    draft.id = created.id;
    saved = snapshot();
    deleteBtn.hidden = false;
    return;
  }

  const fields = changedFields();
  if (!Object.keys(fields).length) return;
  saved = snapshot();
  await store.patch(draft.id, fields);
}

export async function close() {
  if (!draft) return;
  try {
    await flush();
  } catch (err) {
    console.error("save on close failed", err);
  }

  // A note emptied out completely goes to the trash rather than being left
  // blank, matching Keep and keeping the phone's list clean. The trash is where
  // it can be fished back out of if that was a mistake.
  if (draft.id && isBlank()) {
    try {
      await store.trash(draft.id);
    } catch (err) {
      console.error("discard failed", err);
    }
  }

  overlay.hidden = true;
  draft = null;
  items = [];
  uploading = [];
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

imageBtn.addEventListener("click", () => fileEl.click());

fileEl.addEventListener("change", () => {
  addFiles(fileEl.files);
  // Cleared so that picking the same file twice in a row still fires a change.
  fileEl.value = "";
});

// Pasting a screenshot straight into the note, which is the fastest way to get
// one in and the way every other notes app behaves.
editorEl.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  addFiles(files);
});

// Dropping files anywhere on the editor. The dragover handler is what makes the
// drop land here instead of the browser navigating to the file.
editorEl.addEventListener("dragover", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  editorEl.classList.add("dropping");
});

editorEl.addEventListener("dragleave", (event) => {
  if (event.target === editorEl) editorEl.classList.remove("dropping");
});

editorEl.addEventListener("drop", (event) => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  editorEl.classList.remove("dropping");
  addFiles(event.dataTransfer.files);
});

archiveBtn.addEventListener("click", async () => {
  draft.archived = !draft.archived;
  await close();
});

// Straight to the trash, no dialogue: it is undoable for a week, and the note
// is not going anywhere the user cannot reach it.
deleteBtn.addEventListener("click", async () => {
  if (!draft.id) return close();
  const id = draft.id;
  clearTimeout(saveTimer);
  draft = null;
  overlay.hidden = true;
  try {
    await store.trash(id);
    onTrashed(id);
  } catch (err) {
    console.error("delete failed", err);
  }
  onClosed();
});

closeBtn.addEventListener("click", () => close());

overlay.addEventListener("click", (event) => {
  if (event.target === overlay) close();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) close();
});
