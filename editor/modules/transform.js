/**
 * transform.js
 * --------------------------------------------------------------------------
 * Pure geometry for moving, resizing and rotating shapes. Every function takes
 * the shape's state *at the start of the drag* (`orig`) plus the pointer's
 * current position — never the previous frame — so dragging is exact and
 * stateless: nothing accumulates, nothing is stored on the shape between drags.
 *
 * Rotated shapes are resized in their own frame: the pointer is un-rotated
 * about the original centre, the new box is computed as if unrotated, then the
 * centre is rotated back. That keeps the opposite corner/edge fixed on screen.
 * -------------------------------------------------------------------------- */

import { getBounds, getCenter, rotatePoint, isRotatable } from "./shapes.js";
import { mapNodes, translateNodes } from "./path.js";

/** Moves `shape` to `orig` offset by (dx, dy). */
export function moveShape(shape, orig, dx, dy) {
  switch (shape.type) {
    case "line":
    case "arrow":
      shape.x1 = orig.x1 + dx; shape.y1 = orig.y1 + dy;
      shape.x2 = orig.x2 + dx; shape.y2 = orig.y2 + dy;
      break;
    case "pen":
      shape.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case "path":
      shape.nodes = translateNodes(orig.nodes, dx, dy); // a NEW list: history shares the old one
      break;
    default:
      shape.x = orig.x + dx;
      shape.y = orig.y + dy;
  }
}

/** Moves a shape by (dx, dy) from wherever it currently is. */
export function translateShape(shape, dx, dy) {
  moveShape(shape, { ...shape }, dx, dy);
}

const clampFont = (n) => Math.max(8, Math.min(400, Math.round(n)));

/**
 * Resizes one shape by dragging `handle` to world point (px, py).
 * Box shapes use compass handles; lines use endpoints p1/p2; text scales its
 * font from the se corner. Shift toggles aspect lock (images lock by default).
 */
export function resizeShape(shape, orig, handle, px, py, shiftKey = false) {
  if (shape.type === "line" || shape.type === "arrow") {
    if (handle === "p1") { shape.x1 = px; shape.y1 = py; }
    if (handle === "p2") { shape.x2 = px; shape.y2 = py; }
    return;
  }

  const b = getBounds(orig);
  const rot = orig.rotation && isRotatable(orig) ? orig.rotation : 0;
  const c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p = rot ? rotatePoint({ x: px, y: py }, c0, -rot) : { x: px, y: py };

  if (shape.type === "text") {
    shape.fontSize = clampFont(orig.fontSize * Math.max(0.2, (p.y - b.y) / b.h));
    // Font size changes the box, and rotation is about its centre — re-place so the
    // top-left corner stays put on screen.
    const nb = getBounds(shape);
    const topLeft = rot ? rotatePoint({ x: b.x, y: b.y }, c0, rot) : { x: b.x, y: b.y };
    const half = rotatePoint({ x: nb.w / 2, y: nb.h / 2 }, { x: 0, y: 0 }, rot);
    shape.x = topLeft.x + half.x - nb.w / 2;
    shape.y = topLeft.y + half.y - nb.h / 2;
    return;
  }

  let left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
  if (handle.includes("w")) left = p.x;
  if (handle.includes("e")) right = p.x;
  if (handle.includes("n")) top = p.y;
  if (handle.includes("s")) bottom = p.y;

  if (shiftKey !== (shape.type === "image") && handle.length === 2 && b.w > 0 && b.h > 0) {
    const k = Math.max(Math.abs(right - left) / b.w, Math.abs(bottom - top) / b.h);
    const newW = b.w * k, newH = b.h * k;
    if (handle.includes("w")) left = right - newW; else right = left + newW;
    if (handle.includes("n")) top = bottom - newH; else bottom = top + newH;
  }

  const w = Math.max(1, Math.abs(right - left)), h = Math.max(1, Math.abs(bottom - top));
  const localCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const center = rot ? rotatePoint(localCenter, c0, rot) : localCenter;
  if (shape.type === "path") { // scale the path to the new box instead of storing a w/h
    const nx = center.x - w / 2, ny = center.y - h / 2;
    shape.nodes = mapNodes(orig.nodes, p => ({ x: nx + (b.w ? ((p.x - b.x) / b.w) * w : w / 2), y: ny + (b.h ? ((p.y - b.y) / b.h) * h : h / 2) }));
    return;
  }
  shape.w = w; shape.h = h;
  shape.x = center.x - w / 2;
  shape.y = center.y - h / 2;
}

/** Rotates `shape` so its rotation handle points at (px, py). Shift snaps to 15° steps. */
export function rotateShape(shape, orig, px, py, shiftKey = false) {
  const c = getCenter(orig);
  let deg = (Math.atan2(py - c.y, px - c.x) * 180) / Math.PI + 90;
  if (shiftKey) deg = Math.round(deg / 15) * 15;
  deg = ((deg + 540) % 360) - 180; // normalise to [-180, 180)
  shape.rotation = Math.round(deg * 10) / 10;
}

/**
 * Scales a whole multi-selection by dragging a handle of its bounding box.
 * `items` are the shapes to modify, `origs` maps id -> state at drag start.
 */
export function resizeGroup(items, origs, origBounds, handle, px, py, shiftKey = false) {
  const b = origBounds;
  let left = b.x, top = b.y, right = b.x + b.w, bottom = b.y + b.h;
  if (handle.includes("w")) left = px;
  if (handle.includes("e")) right = px;
  if (handle.includes("n")) top = py;
  if (handle.includes("s")) bottom = py;

  if (shiftKey && handle.length === 2 && b.w > 0 && b.h > 0) {
    const k = Math.max(Math.abs(right - left) / b.w, Math.abs(bottom - top) / b.h);
    const newW = b.w * k, newH = b.h * k;
    if (handle.includes("w")) left = right - newW; else right = left + newW;
    if (handle.includes("n")) top = bottom - newH; else bottom = top + newH;
  }

  const nb = { x: Math.min(left, right), y: Math.min(top, bottom), w: Math.max(1, Math.abs(right - left)), h: Math.max(1, Math.abs(bottom - top)) };
  const sx = b.w > 0 ? nb.w / b.w : 1, sy = b.h > 0 ? nb.h / b.h : 1;
  const mx = (x) => nb.x + (x - b.x) * sx;
  const my = (y) => nb.y + (y - b.y) * sy;

  for (const s of items) {
    const o = origs.get(s.id);
    switch (s.type) {
      case "line":
      case "arrow":
        s.x1 = mx(o.x1); s.y1 = my(o.y1); s.x2 = mx(o.x2); s.y2 = my(o.y2);
        break;
      case "pen":
        s.points = o.points.map(p => ({ x: mx(p.x), y: my(p.y) }));
        break;
      case "path":
        s.nodes = mapNodes(o.nodes, p => ({ x: mx(p.x), y: my(p.y) }));
        break;
      case "text":
        s.fontSize = clampFont(o.fontSize * sy);
        s.x = mx(o.x); s.y = my(o.y);
        break;
      default: {
        const ob = getBounds(o);
        s.x = mx(ob.x); s.y = my(ob.y);
        s.w = ob.w * sx; s.h = ob.h * sy;
      }
    }
  }
  return { nb, sx, sy };
}
