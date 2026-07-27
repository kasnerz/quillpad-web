// In-memory note list plus optimistic writes. Every mutation updates local
// state first so the UI never waits on the network, and rolls back if the
// request fails.

import * as api from "./api.js";

let notes = [];
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(notes);
}

export const all = () => notes;
export const get = (id) => notes.find((note) => note.id === id);

export async function reload() {
  notes = (await api.listNotes()) || [];
  emit();
  return notes;
}

export async function create(fields) {
  const saved = await api.createNote(fields);
  notes.push(saved);
  emit();
  return saved;
}

export async function patch(id, fields) {
  const note = get(id);
  if (!note) return null;

  const before = { ...note };
  Object.assign(note, fields);
  emit();

  try {
    const saved = await api.updateNote(id, fields);
    if (saved) Object.assign(note, saved);
    emit();
    return note;
  } catch (err) {
    Object.assign(note, before);
    emit();
    throw err;
  }
}

export async function remove(id) {
  const index = notes.findIndex((note) => note.id === id);
  if (index < 0) return;
  const [removed] = notes.splice(index, 1);
  emit();

  try {
    await api.deleteNote(id);
  } catch (err) {
    notes.splice(index, 0, removed);
    emit();
    throw err;
  }
}

// ids is the full ordering, so positions stay globally consistent even though
// the grid is split into pinned and unpinned sections.
export async function reorder(ids) {
  ids.forEach((id, index) => {
    const note = get(id);
    if (note) note.position = index;
  });
  emit();
  await api.reorderNotes(ids);
}
