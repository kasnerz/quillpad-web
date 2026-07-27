// Colour names are Quillpad's NoteColor enum, so the stored value stays
// meaningful to the phone if it ever learns to sync colours. The hex values
// live in style.css as --note-<name> custom properties, one pair per theme.

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
  // the anchor sits near an edge.
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  let top = rect.top - height - 8;

  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  if (top < 8) top = rect.bottom + 8;

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
