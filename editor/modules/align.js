/**
 * align.js
 * --------------------------------------------------------------------------
 * Align and distribute, as in Figma's toolbar. Both work on world-space
 * bounds (so rotated shapes align by what you see) and move shapes with
 * translateShape. They return whether anything was actually moved.
 * -------------------------------------------------------------------------- */

import { getWorldBounds, unionBounds } from "./shapes.js";
import { translateShape } from "./transform.js";

/** mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom". Needs 2+ shapes. */
export function alignShapes(shapes, mode) {
  if (shapes.length < 2) return false;
  const u = unionBounds(shapes.map(getWorldBounds));
  let moved = false;
  for (const s of shapes) {
    const b = getWorldBounds(s);
    let dx = 0, dy = 0;
    if (mode === "left") dx = u.x - b.x;
    else if (mode === "hcenter") dx = u.x + u.w / 2 - (b.x + b.w / 2);
    else if (mode === "right") dx = u.x + u.w - (b.x + b.w);
    else if (mode === "top") dy = u.y - b.y;
    else if (mode === "vcenter") dy = u.y + u.h / 2 - (b.y + b.h / 2);
    else if (mode === "bottom") dy = u.y + u.h - (b.y + b.h);
    if (dx || dy) { translateShape(s, dx, dy); moved = true; }
  }
  return moved;
}

/** Evens out the gaps between shapes along "x" or "y"; the outermost two stay put. Needs 3+ shapes. */
export function distributeShapes(shapes, axis) {
  if (shapes.length < 3) return false;
  const horizontal = axis === "x";
  const items = shapes.map(shape => ({ shape, b: getWorldBounds(shape) }));
  const start = (b) => (horizontal ? b.x : b.y);
  const size = (b) => (horizontal ? b.w : b.h);
  items.sort((p, q) => start(p.b) + size(p.b) / 2 - (start(q.b) + size(q.b) / 2));

  const first = items[0].b, last = items[items.length - 1].b;
  const span = start(last) + size(last) - start(first);
  const gap = (span - items.reduce((sum, it) => sum + size(it.b), 0)) / (items.length - 1);

  let cursor = start(first) + size(first) + gap, moved = false;
  for (let i = 1; i < items.length - 1; i++) {
    const delta = cursor - start(items[i].b);
    if (delta) { translateShape(items[i].shape, horizontal ? delta : 0, horizontal ? 0 : delta); moved = true; }
    cursor += size(items[i].b) + gap;
  }
  return moved;
}
