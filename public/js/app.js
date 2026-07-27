import * as store from "./store.js";
import { subscribeChanges } from "./api.js";
import { MasonryGrid } from "./layout.js";
import { renderCard } from "./card.js";
import * as editor from "./editor.js";
import { closePalette } from "./palette.js";

const SAFETY_POLL_MS = 60000;

let view = "notes";
let query = "";

const sectionPinned = document.getElementById("section-pinned");
const sectionOthers = document.getElementById("section-others");
const othersLabel = document.getElementById("others-label");
const emptyState = document.getElementById("empty-state");
const syncDot = document.getElementById("sync-dot");

const gridPinned = new MasonryGrid(document.getElementById("grid-pinned"), {
  onReorder: commitOrder,
});
const gridOthers = new MasonryGrid(document.getElementById("grid-others"), {
  onReorder: commitOrder,
});

const handlers = {
  onOpen: (id) => {
    const note = store.get(id);
    if (note) editor.openNote(note);
  },
  onPatch: (id, fields) => {
    store.patch(id, fields).catch((err) => toast(`Could not save: ${err.message}`));
  },
  onDelete: (id) => {
    if (!confirm("Delete this note?")) return;
    store.remove(id).catch((err) => toast(`Could not delete: ${err.message}`));
  },
};

/* ---------------------------------------------------------------- *
 * Rendering                                                         *
 * ---------------------------------------------------------------- */

function visibleNotes() {
  const needle = query.trim().toLowerCase();
  let notes = store.all().filter((note) => !!note.archived === (view === "archive"));

  if (needle) {
    notes = notes.filter((note) =>
      `${note.title || ""}\n${note.content || ""}`.toLowerCase().includes(needle)
    );
  }

  return notes.sort((a, b) => a.position - b.position || a.id - b.id);
}

function render() {
  // A re-render mid-drag would rebuild the card being dragged out from under
  // the pointer.
  if (gridPinned.dragging || gridOthers.dragging) return;

  const notes = visibleNotes();
  // Archive is a flat list; pinning only structures the main view, as in Keep.
  const pinned = view === "notes" ? notes.filter((n) => n.favorite) : [];
  const others = view === "notes" ? notes.filter((n) => !n.favorite) : notes;

  // Visibility has to be settled *before* laying out: a hidden section has a
  // clientWidth of 0, so the grid would bail out of positioning and the cards
  // would still be stacked at the origin when the section became visible.
  sectionPinned.hidden = pinned.length === 0;
  othersLabel.hidden = pinned.length === 0 || others.length === 0;
  sectionOthers.hidden = others.length === 0;

  fill(gridPinned, pinned);
  fill(gridOthers, others);

  emptyState.hidden = notes.length > 0;
  if (!notes.length) {
    emptyState.textContent = query
      ? "No notes match your search."
      : view === "archive"
      ? "Nothing archived."
      : "Notes you add appear here.";
  }
}

function fill(grid, notes) {
  grid.el.innerHTML = "";
  const items = notes.map((note) => {
    const el = renderCard(note, handlers);
    grid.el.appendChild(el);
    return { id: note.id, el };
  });
  grid.setItems(items);
  grid.layout(false);
}

function relayout() {
  gridPinned.layout(false);
  gridOthers.layout(false);
}

function commitOrder() {
  const visibleIds = [
    ...gridPinned.items.map((item) => item.id),
    ...gridOthers.items.map((item) => item.id),
  ];
  const visible = new Set(visibleIds);

  // Positions are global, but the grid only ever shows a subset (a view, maybe
  // filtered by a search). Drop the new visible order into the slots the
  // visible notes already occupied, so hidden notes keep their places.
  const ordered = store
    .all()
    .slice()
    .sort((a, b) => a.position - b.position || a.id - b.id);

  let next = 0;
  const ids = ordered.map((note) => (visible.has(note.id) ? visibleIds[next++] : note.id));

  store.reorder(ids).catch((err) => toast(`Could not save order: ${err.message}`));
}

/* ---------------------------------------------------------------- *
 * Chrome                                                            *
 * ---------------------------------------------------------------- */

document.getElementById("composer").addEventListener("click", (event) => {
  if (event.target.closest("#composer-list")) return;
  editor.openNote(null);
});

document.getElementById("composer-list").addEventListener("click", (event) => {
  event.stopPropagation();
  editor.openNote(null, { noteType: "list" });
});

for (const button of document.querySelectorAll(".nav-item")) {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    for (const other of document.querySelectorAll(".nav-item")) {
      other.classList.toggle("active", other === button);
    }
    render();
  });
}

document.getElementById("search-input").addEventListener("input", (event) => {
  query = event.target.value;
  render();
});

document.getElementById("nav-toggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("collapsed");
  requestAnimationFrame(relayout);
});

editor.setOnClosed(render);

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 80);
  closePalette();
});

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ---------------------------------------------------------------- *
 * Staying live                                                      *
 * ---------------------------------------------------------------- */

store.subscribe(render);

async function refresh() {
  try {
    await store.reload();
  } catch (err) {
    console.error("refresh failed", err);
  }
}

subscribeChanges({
  // The payload only says "something changed"; refetching the list is cheap at
  // this size and cannot drift the way an incremental merge can.
  onChange: refresh,
  onStatus: (status) => {
    syncDot.classList.toggle("live", status === "live");
    syncDot.classList.toggle("stale", status !== "live");
    syncDot.title = status === "live" ? "Live updates connected" : "Reconnecting…";
  },
});

// Fallbacks, so a stream that died while the laptop slept still heals.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
window.addEventListener("focus", refresh);
setInterval(() => {
  if (!document.hidden) refresh();
}, SAFETY_POLL_MS);

refresh();
