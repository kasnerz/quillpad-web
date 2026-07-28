// Colour names are Quillpad's NoteColor enum, so the stored value stays
// meaningful to the phone if it ever learns to sync colours. The hex values
// live in style.css as --note-<name> custom properties, one pair per theme.

import { uiScale } from "./zoom.js";

export const COLORS = [
  "Default", "Red", "Orange", "Yellow", "Green", "Teal",
  "Cyan", "Blue", "Purple", "Pink", "Brown", "Gray",
];

export function colorVar(name) {
  const key = (name || "Default").toLowerCase();
  return COLORS.some((c) => c.toLowerCase() === key)
    ? `var(--note-${key})`
    : "var(--note-default)";
}

const CHECK = `<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>`;

let open = null;

export function closePalette() {
  if (!open) return;
  open.remove();
  open = null;
}

/** Floating swatch picker, anchored under a button. */
export function openPalette(anchor, current, onPick) {
  closePalette();

  const menu = document.createElement("div");
  menu.className = "palette floating";

  for (const name of COLORS) {
    const swatch = document.createElement("button");
    swatch.className = "swatch";
    swatch.title = name;
    swatch.style.background = colorVar(name);
    swatch.innerHTML = CHECK;
    if ((current || "Default") === name) swatch.classList.add("selected");
    swatch.addEventListener("click", (event) => {
      event.stopPropagation();
      onPick(name);
      closePalette();
    });
    menu.appendChild(swatch);
  }

  document.body.appendChild(menu);

  // Positioned in viewport coordinates, then nudged back inside the window if
  // the anchor sits near an edge. The anchor's rect and innerWidth are client
  // px; left/top and offsetWidth are the menu's own, so the zoom divides out of
  // the first pair to put everything in one space. See js/zoom.js.
  const scale = uiScale();
  const rect = anchor.getBoundingClientRect();
  const viewport = window.innerWidth / scale;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = (rect.left + rect.width / 2) / scale - width / 2;
  let top = rect.top / scale - height - 8;

  left = Math.max(8, Math.min(left, viewport - width - 8));
  if (top < 8) top = rect.bottom / scale + 8;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  open = menu;
  // Deferred, or the click that opened the palette would immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", onDocumentDown, { once: true });
  }, 0);
}

function onDocumentDown(event) {
  if (open && !open.contains(event.target)) closePalette();
}
