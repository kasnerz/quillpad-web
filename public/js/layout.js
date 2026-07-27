// Masonry laid out in JavaScript, with drag-to-reorder on top.
//
// CSS columns would be far less code, but they flow items top-to-bottom and
// then across, so the card in the second visual slot is not the second item in
// the list. That makes "drop here" impossible to translate back into an index.
// Positioning absolutely means visual order and array order are the same thing.
//
// Dragging uses Pointer Events rather than HTML5 drag-and-drop so that mouse
// and touch take the same path and the drag image is the real card.

const GAP = 16;
const MIN_COLUMN = 240;
const DRAG_THRESHOLD = 5;

export class MasonryGrid {
  constructor(element, { onReorder }) {
    this.el = element;
    this.onReorder = onReorder;
    this.items = []; // [{ id, el }] in visual order
    this.rects = []; // laid-out geometry, index-aligned with items
    this.pending = null;
    this.drag = null;

    this.el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    // Bound on window so a fast drag that outruns the cursor still tracks.
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
  }

  get dragging() {
    return this.drag !== null;
  }

  setItems(items) {
    this.items = items;
  }

  /** @param animate false to place cards without sliding them in. */
  layout(animate = true) {
    const width = this.el.clientWidth;
    if (!width) return;

    if (!animate) this.el.classList.add("no-anim");

    const columns = Math.max(1, Math.floor((width + GAP) / (MIN_COLUMN + GAP)));
    const columnWidth = (width - GAP * (columns - 1)) / columns;

    // Widths first, heights second: reading a height while widths are still
    // being written would measure the previous layout.
    for (const item of this.items) item.el.style.width = `${columnWidth}px`;

    const heights = new Array(columns).fill(0);
    this.rects = [];

    for (const item of this.items) {
      const height = item.el.offsetHeight;

      let column = 0;
      for (let i = 1; i < columns; i++) {
        if (heights[i] < heights[column] - 0.5) column = i;
      }

      const x = column * (columnWidth + GAP);
      const y = heights[column];
      heights[column] = y + height + GAP;
      this.rects.push({ x, y, w: columnWidth, h: height });

      // The dragged card follows the pointer, not the layout.
      if (!this.drag || this.drag.item !== item) {
        item.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }

    this.el.style.height = `${Math.max(0, Math.max(...heights) - GAP)}px`;

    if (!animate) {
      void this.el.offsetHeight; // flush, so the suppressed transition applies
      this.el.classList.remove("no-anim");
    }
  }

  onPointerDown(event) {
    if (event.button !== 0) return;

    const cardEl = event.target.closest(".card");
    if (!cardEl || !this.el.contains(cardEl)) return;
    // Controls keep their own clicks; only the card body initiates a drag.
    if (event.target.closest("button, input, textarea, a")) return;

    const index = this.items.findIndex((item) => item.el === cardEl);
    if (index < 0) return;

    this.pending = { index, x: event.clientX, y: event.clientY };
  }

  onPointerMove(event) {
    if (this.pending && !this.drag) {
      const moved =
        Math.abs(event.clientX - this.pending.x) +
        Math.abs(event.clientY - this.pending.y);
      // A click is not a drag; wait for real movement before committing, or
      // opening a note would become impossible.
      if (moved < DRAG_THRESHOLD) return;
      this.startDrag(event);
    }
    if (!this.drag) return;

    event.preventDefault();

    const gridRect = this.el.getBoundingClientRect();
    const x = event.clientX - gridRect.left - this.drag.offsetX;
    const y = event.clientY - gridRect.top - this.drag.offsetY;
    this.drag.item.el.style.transform = `translate(${x}px, ${y}px) scale(1.02)`;

    const centre = {
      x: x + this.drag.width / 2,
      y: y + this.drag.height / 2,
    };
    const target = this.indexAt(centre.x, centre.y);

    if (target >= 0 && target !== this.drag.index) {
      const [item] = this.items.splice(this.drag.index, 1);
      this.items.splice(target, 0, item);
      this.drag.index = target;
      this.layout(); // the other cards animate aside
    }
  }

  onPointerUp() {
    this.pending = null;
    if (!this.drag) return;

    const { item } = this.drag;
    item.el.classList.remove("is-dragging");
    this.el.classList.remove("dragging");
    document.body.style.userSelect = "";
    this.drag = null;

    this.layout(); // snap the dropped card into its slot
    this.onReorder(this.items.map((entry) => entry.id));
  }

  startDrag(event) {
    const { index } = this.pending;
    const item = this.items[index];
    const rect = this.rects[index];
    if (!item || !rect) return;

    const gridRect = this.el.getBoundingClientRect();
    this.drag = {
      item,
      index,
      width: rect.w,
      height: rect.h,
      offsetX: event.clientX - gridRect.left - rect.x,
      offsetY: event.clientY - gridRect.top - rect.y,
    };

    item.el.classList.add("is-dragging");
    this.el.classList.add("dragging");
    // Keeps text selection and native scrolling from fighting the drag.
    document.body.style.userSelect = "none";
  }

  /** Index of the slot containing a point, or -1. */
  indexAt(x, y) {
    for (let i = 0; i < this.rects.length; i++) {
      const rect = this.rects[i];
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return i;
      }
    }
    return -1;
  }
}
