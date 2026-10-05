/**
 * selection.js
 * --------------------------------------------------------------------------
 * Pure helpers for choosing shapes: groups, hit picking, marquee, bounds.
 * No state lives here — tools.js owns the selection; this answers questions.
 * -------------------------------------------------------------------------- */

import { hitTest, getWorldBounds, unionBounds } from "./shapes.js";
import { hitTestConnector } from "./connectors.js";
import { byIdMap, clippingAncestors } from "./hierarchy.js";
import { LABEL_TYPES, hitLabel } from "./overlays.js";

/** `ids` plus every shape sharing a groupId with any of them. */
export function expandGroups(ids, shapes) {
  const wanted = new Set(ids);
  const groups = new Set(shapes.filter(s => wanted.has(s.id) && s.groupId).map(s => s.groupId));
  return shapes.filter(s => wanted.has(s.id) || (s.groupId && groups.has(s.groupId))).map(s => s.id);
}

/** Shapes that can be moved/resized: real nodes (not connectors) that aren't locked. */
export const movableShapes = (shapes) => shapes.filter(s => s.type !== "connector" && !s.locked);

/** Union of world bounds of the non-connector shapes, or null. */
export function selectionBounds(shapes) {
  return unionBounds(shapes.filter(s => s.type !== "connector").map(getWorldBounds));
}

const within = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * Topmost selectable shape at (px,py). Rules, in order:
 *   - nodes win over connectors (they're drawn above them);
 *   - a child clipped by its frame can't be picked outside the frame (it isn't visible there);
 *   - a frame/section/slice's name label counts as part of it (so you can grab a frame by its label).
 * `scale` is the zoom, needed to size labels.
 */
export function topHit(shapes, px, py, tol, scale = 1) {
  const hidden = new Set(shapes.filter(s => s.hidden).map(s => s.id));
  const byId = byIdMap(shapes);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === "connector" || s.hidden || s.locked) continue;
    if (!clippingAncestors(s, byId).every(a => within(getWorldBounds(a), px, py))) continue;
    if (hitTest(s, px, py, tol, scale)) return s;
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (LABEL_TYPES.has(s.type) && !s.hidden && !s.locked && hitLabel(s, px, py, scale)) return s;
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type !== "connector" || s.hidden || s.locked || hidden.has(s.fromId) || hidden.has(s.toId)) continue;
    if (hitTestConnector(s, shapes, px, py, tol)) return s;
  }
  return null;
}

const intersects = (a, r) => a.x <= r.x + r.w && a.x + a.w >= r.x && a.y <= r.y + r.h && a.y + a.h >= r.y;

/** The part of `b` inside `clip`, or null if they don't overlap. */
function clipBounds(b, clip) {
  const x = Math.max(b.x, clip.x), y = Math.max(b.y, clip.y);
  const r = Math.min(b.x + b.w, clip.x + clip.w), bt = Math.min(b.y + b.h, clip.y + clip.h);
  return r >= x && bt >= y ? { x, y, w: r - x, h: bt - y } : null;
}

/**
 * Ids touched by a marquee rectangle. Only the VISIBLE part of a shape counts
 * (what its clipping frames let through), so you can't box-select what you can't
 * see. A connector is included only if both its nodes are.
 */
export function shapesInRect(shapes, rect) {
  const byId = byIdMap(shapes);
  const picked = new Set();
  for (const s of shapes) {
    if (s.type === "connector" || s.hidden || s.locked) continue;
    let visible = getWorldBounds(s);
    for (const frame of clippingAncestors(s, byId)) {
      visible = visible && clipBounds(visible, getWorldBounds(frame));
      if (!visible) break;
    }
    if (visible && intersects(visible, rect)) picked.add(s.id);
  }
  for (const s of shapes) {
    if (s.type === "connector" && !s.hidden && !s.locked && picked.has(s.fromId) && picked.has(s.toId)) picked.add(s.id);
  }
  return [...picked];
}
