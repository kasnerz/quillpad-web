// In-memory note list plus optimistic writes. Every mutation updates local
// state first so the UI never waits on the network, and rolls back if the
// request fails.

import * as api from "./api.js";

let notes = [];
// Trashed notes are kept apart rather than filtered out of `notes`, because the
// server withholds them from the notes listing and hands them over separately.
let trashed = [];
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

export const allTrashed = () => trashed;
export const getTrashed = (id) => trashed.find((note) => note.id === id);

export async function reload() {
  const [live, binned] = await Promise.all([api.listNotes(), api.listTrash()]);
  notes = live || [];
  trashed = binned || [];
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

/* ---------------------------------------------------------------- *
 * The trash                                                         *
 * ---------------------------------------------------------------- */

// Moves a note between the two lists optimistically and puts it back where it
// came from if the write fails.
async function move(from, to, id, fields) {
  const index = from.findIndex((note) => note.id === id);
  if (index < 0) return null;

  const [note] = from.splice(index, 1);
  const before = { ...note };
  Object.assign(note, fields);
  to.push(note);
  emit();

  try {
    const saved = await api.updateNote(id, fields);
    if (saved) Object.assign(note, saved);
    emit();
    return note;
  } catch (err) {
    to.splice(to.indexOf(note), 1);
    Object.assign(note, before);
    from.splice(index, 0, note);
    emit();
    throw err;
  }
}

// `deleted` is when the note was thrown away, in epoch seconds, and doubles as
// the flag: zero means live. The retention countdown is measured from it.
export const trash = (id) => move(notes, trashed, id, { deleted: api.nowSeconds() });

export const restore = (id) => move(trashed, notes, id, { deleted: 0 });

/** Permanent, and only reachable from inside the trash. */
export async function destroy(id) {
  const index = trashed.findIndex((note) => note.id === id);
  if (index < 0) return;
  const [removed] = trashed.splice(index, 1);
  emit();

  try {
    await api.deleteNote(id);
  } catch (err) {
    trashed.splice(index, 0, removed);
    emit();
    throw err;
  }
}

export async function emptyTrash() {
  const removed = trashed;
  trashed = [];
  emit();

  try {
    await api.emptyTrash();
  } catch (err) {
    trashed = removed;
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
