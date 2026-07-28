// The interface renders at --ui-zoom (see style.css). CSS `zoom` is the right
// tool for that because it reflows — text rewraps, columns recount — where
// transform: scale() would just magnify a layout built for a smaller window.
//
// The catch is that it splits two coordinate systems this app's pointer maths
// used to treat as one. getBoundingClientRect and pointer events report *client*
// px, which include the zoom; offsetWidth/clientWidth and the left/top we write
// back are in the zoomed element's *own* px, which do not. Mixing the two puts
// a dragged card and the cursor a factor of --ui-zoom apart.
//
// Measured rather than read back from the CSS, so the two cannot drift apart —
// and so this returns exactly 1, leaving the maths untouched, when the zoom is 1
// or the browser happens to report both alike.

export function uiScale() {
  const width = document.body.clientWidth;
  if (!width) return 1;
  const scale = document.body.getBoundingClientRect().width / width;
  // Guard against a transient 0 or a NaN rather than propagating it into a
  // division that would park a card at the top-left corner.
  return scale > 0 ? scale : 1;
}
