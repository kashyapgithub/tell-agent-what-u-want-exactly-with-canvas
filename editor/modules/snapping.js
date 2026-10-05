/**
 * snapping.js
 * --------------------------------------------------------------------------
 * Smart guides: while dragging, a box's left/centre/right (and top/middle/
 * bottom) snap to the same lines of nearby shapes, and guide lines are
 * returned for the renderer to draw. Pure functions — no DOM, no state.
 * -------------------------------------------------------------------------- */

import { getWorldBounds } from "./shapes.js";

const EPS = 0.5; // two lines closer than this count as aligned

/** World bounds of every visible, non-connector shape not in `excludeIds`. */
export function collectSnapTargets(shapes, excludeIds) {
  return shapes
    .filter(s => s.type !== "connector" && s.type !== "comment" && !s.hidden && !excludeIds.has(s.id))
    .map(getWorldBounds);
}

const xLines = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
const yLines = (b) => [b.y, b.y + b.h / 2, b.y + b.h];

/** Smallest signed distance from any of `mine` to any of `theirs`, if within `threshold`. */
function bestDelta(mine, theirs, threshold) {
  let best = null;
  for (const a of mine) for (const t of theirs) {
    const d = t - a;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/**
 * Given the box being dragged (`box`, already at its unsnapped position),
 * returns { dx, dy, guides } — the correction to apply and the guide lines
 * to draw at the snapped position. Guide: { axis: "x"|"y", pos, from, to }.
 */
export function snapMove(box, targets, threshold) {
  const dx = bestDelta(xLines(box), targets.flatMap(xLines), threshold) ?? 0;
  const dy = bestDelta(yLines(box), targets.flatMap(yLines), threshold) ?? 0;
  const snapped = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };

  const guides = [];
  const seen = new Set();
  for (const pos of xLines(snapped)) {
    const hits = targets.filter(t => xLines(t).some(l => Math.abs(l - pos) < EPS));
    if (!hits.length || seen.has(`x${pos.toFixed(1)}`)) continue;
    seen.add(`x${pos.toFixed(1)}`);
    guides.push({
      axis: "x", pos,
      from: Math.min(snapped.y, ...hits.map(t => t.y)),
      to: Math.max(snapped.y + snapped.h, ...hits.map(t => t.y + t.h)),
    });
  }
  for (const pos of yLines(snapped)) {
    const hits = targets.filter(t => yLines(t).some(l => Math.abs(l - pos) < EPS));
    if (!hits.length || seen.has(`y${pos.toFixed(1)}`)) continue;
    seen.add(`y${pos.toFixed(1)}`);
    guides.push({
      axis: "y", pos,
      from: Math.min(snapped.x, ...hits.map(t => t.x)),
      to: Math.max(snapped.x + snapped.w, ...hits.map(t => t.x + t.w)),
    });
  }
  return { dx, dy, guides };
}
