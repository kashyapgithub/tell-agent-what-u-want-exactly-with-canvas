/**
 * hierarchy.js
 * --------------------------------------------------------------------------
 * Parent/child structure for frames and sections. The shape list stays FLAT
 * (so history, export and everything else keep working); a child just carries
 * `parentId`, and one invariant holds: **a parent appears before its children
 * in the list** (so it paints underneath them). enforceHierarchy() restores
 * that after anything reorders shapes.
 *
 * Pure functions — no DOM, no state.
 * -------------------------------------------------------------------------- */

import { getWorldBounds } from "./shapes.js";

/** Shapes that can contain others. Slices only mark an export region. */
export const CONTAINER_TYPES = new Set(["frame", "section"]);

export const byIdMap = (shapes) => new Map(shapes.map(s => [s.id, s]));

export const childrenOf = (shapes, id) => shapes.filter(s => s.parentId === id);

/** Every descendant (children, grandchildren, …) of the given ids — not the ids themselves. */
export function descendantsOf(shapes, ids) {
  const roots = new Set(ids), out = [], seen = new Set(roots);
  let frontier = [...roots];
  while (frontier.length) {
    const next = [];
    for (const s of shapes) {
      if (s.parentId && frontier.includes(s.parentId) && !seen.has(s.id)) { seen.add(s.id); out.push(s); next.push(s.id); }
    }
    frontier = next;
  }
  return out;
}

/** The chain of parents above `shape`, nearest first. */
export function ancestorsOf(shape, byId) {
  const chain = [], seen = new Set();
  let cur = shape.parentId ? byId.get(shape.parentId) : null;
  while (cur && !seen.has(cur.id)) { chain.push(cur); seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return chain;
}

/** Ancestors that clip their contents (frames with `clip` on), nearest first. */
export const clippingAncestors = (shape, byId) => ancestorsOf(shape, byId).filter(a => a.type === "frame" && a.clip);

/** Drops shapes whose ancestor is also in the list — moving the ancestor already carries them. */
export function topLevelOf(shapes, all) {
  const ids = new Set(shapes.map(s => s.id)), byId = byIdMap(all);
  return shapes.filter(s => !ancestorsOf(s, byId).some(a => ids.has(a.id)));
}

const contains = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * The container a shape belongs inside: the topmost frame/section whose bounds
 * contain the shape's centre, ignoring `excludeIds` (the shape itself and its
 * own descendants — a frame can't become a child of something inside it).
 */
export function findParent(shapes, shape, excludeIds) {
  const b = getWorldBounds(shape);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const c = shapes[i];
    if (!CONTAINER_TYPES.has(c.type) || c.hidden || excludeIds.has(c.id)) continue;
    if (contains(getWorldBounds(c), cx, cy)) return c.id;
  }
  return null;
}

/** Re-parents each of `moved` to whichever container its centre now sits in (null = canvas). */
export function reparent(shapes, moved) {
  for (const s of moved) {
    const exclude = new Set([s.id, ...descendantsOf(shapes, [s.id]).map(d => d.id)]);
    const parentId = findParent(shapes, s, exclude);
    if (s.type !== "slice") s.parentId = parentId; // slices are free-floating regions
  }
}

/**
 * Returns the list reordered so every parent precedes its children (children
 * keep their relative order, immediately after the parent), and clears
 * `parentId` on orphans whose parent no longer exists.
 */
export function enforceHierarchy(shapes) {
  const ids = new Set(shapes.map(s => s.id));
  for (const s of shapes) if (s.parentId && !ids.has(s.parentId)) s.parentId = null;

  const kids = new Map();
  for (const s of shapes) if (s.parentId) { if (!kids.has(s.parentId)) kids.set(s.parentId, []); kids.get(s.parentId).push(s); }

  const out = [], placed = new Set();
  const place = (s) => {
    if (placed.has(s.id)) return;
    placed.add(s.id); out.push(s);
    for (const c of kids.get(s.id) || []) place(c);
  };
  for (const s of shapes) if (!s.parentId) place(s);
  for (const s of shapes) place(s); // anything caught in a parent cycle still gets listed
  return out;
}

/**
 * Layers-panel order: frontmost first, each container immediately followed by
 * its children (also frontmost first), with the nesting depth for indentation.
 */
export function treeOrder(shapes) {
  const kids = new Map(), ids = new Set(shapes.map(s => s.id));
  for (const s of shapes) {
    const key = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(s);
  }
  const out = [];
  const walk = (list, depth) => {
    for (let i = list.length - 1; i >= 0; i--) {
      out.push({ shape: list[i], depth });
      walk(kids.get(list[i].id) || [], depth + 1);
    }
  };
  walk(kids.get(null) || [], 0);
  return out;
}
