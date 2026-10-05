/**
 * exportScope.js
 * --------------------------------------------------------------------------
 * Decides WHAT gets exported. Select exactly one frame, section or slice and
 * "Send to project" exports just that region (its own PNG, and only the shapes
 * inside it) — that's how you hand an agent one screen at a time. With
 * anything else selected, the whole canvas is exported.
 *
 *   frame / section  -> the container and everything inside it
 *   slice            -> every shape that overlaps the slice
 * -------------------------------------------------------------------------- */

import { getBounds, getWorldBounds, visibleShapes, layerLabel, hitTest } from "./shapes.js";
import { commentNumbers } from "./overlays.js";
import { pathToSvg } from "./path.js";
import { CONTAINER_TYPES } from "./hierarchy.js";
import { descendantsOf } from "./hierarchy.js";

const overlaps = (a, r) => a.x <= r.x + r.w && a.x + a.w >= r.x && a.y <= r.y + r.h && a.y + a.h >= r.y;

const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** The shape a comment is about: the topmost real shape under its pin, else the container around it. */
function nearShape(shapes, x, y) {
  const real = shapes.filter(s => !["comment", "connector", "slice"].includes(s.type));
  for (let i = real.length - 1; i >= 0; i--) if (!CONTAINER_TYPES.has(real[i].type) && hitTest(real[i], x, y, 3)) return real[i];
  for (let i = real.length - 1; i >= 0; i--) if (CONTAINER_TYPES.has(real[i].type) && inside(getWorldBounds(real[i]), x, y)) return real[i];
  return null;
}

/** Comments in scope as export notes (numbered like the pins drawn on the PNG). */
function notesFor(visible, region) {
  const numbers = commentNumbers(visible);
  return visible.filter(s => s.type === "comment" && (!region || inside(region, s.x, s.y))).map(c => {
    const near = nearShape(visible, c.x, c.y);
    return { n: numbers.get(c.id), text: c.text || "", resolved: !!c.resolved, x: c.x, y: c.y, nearShapeId: near?.id ?? null, nearShapeName: near ? layerLabel(near) : null };
  });
}

/** Returns { shapes, region, scope, slices, notes, pins } for the current selection. */
export function exportScope(allShapes, selection) {
  const visible = visibleShapes(allShapes);
  const slices = visible.filter(s => s.type === "slice");
  const sliceInfo = slices.map(s => { const b = getBounds(s); return { id: s.id, name: layerLabel(s), x: b.x, y: b.y, w: b.w, h: b.h }; });
  const done = (shapes, region, scope) => {
    const notes = notesFor(visible, region);
    // Vector paths also export their SVG path data (`d`) — exact, and directly usable by an agent.
    const withPaths = shapes.filter(s => s.type !== "comment").map(s => (s.type === "path" ? { ...s, d: pathToSvg(s) } : s));
    return { shapes: withPaths, region, scope, slices: sliceInfo, notes, pins: notes.map(n => ({ x: n.x, y: n.y, n: n.n, resolved: n.resolved })) };
  };

  const only = selection.length === 1 ? selection[0] : null;
  if (!only || !["frame", "section", "slice"].includes(only.type) || only.hidden) {
    return done(visible.filter(s => s.type !== "slice"), null, null);
  }

  const b = getBounds(only);
  const region = { x: b.x, y: b.y, w: b.w, h: b.h };
  let shapes;
  if (only.type === "slice") {
    const hit = new Set(visible.filter(s => s.type !== "slice" && s.type !== "connector" && overlaps(getWorldBounds(s), region)).map(s => s.id));
    shapes = visible.filter(s => hit.has(s.id) || (s.type === "connector" && hit.has(s.fromId) && hit.has(s.toId)));
  } else {
    const within = new Set([only.id, ...descendantsOf(visible, [only.id]).map(s => s.id)]);
    shapes = visible.filter(s => within.has(s.id) || (s.type === "connector" && within.has(s.fromId) && within.has(s.toId)));
  }
  return done(shapes, region, { type: only.type, id: only.id, name: layerLabel(only), ...region });
}
