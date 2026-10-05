/**
 * clipboard.js
 * --------------------------------------------------------------------------
 * Cloning for duplicate / copy / paste. Copies get fresh ids, groups get fresh
 * group ids (so a pasted group is independent of the original), and connectors
 * are re-pointed at the copied nodes — a connector is only carried along if
 * both of its nodes are, so nothing is left dangling.
 * -------------------------------------------------------------------------- */

import { nextId } from "./shapes.js";
import { translateShape } from "./transform.js";
import { descendantsOf } from "./hierarchy.js";

/** The selected nodes, everything inside them (frame contents), and connectors running between the included nodes — in z-order. */
export function gatherWithConnectors(selection, allShapes) {
  const picked = selection.filter(s => s.type !== "connector");
  const ids = new Set([...picked.map(s => s.id), ...descendantsOf(allShapes, picked.map(s => s.id)).map(s => s.id)]);
  return allShapes.filter(s => ids.has(s.id) || (s.type === "connector" && ids.has(s.fromId) && ids.has(s.toId)));
}

/** Deep-enough copies of `shapes`, offset by (dx, dy). Connectors whose nodes aren't in the list are dropped. */
export function cloneShapes(shapes, dx = 0, dy = 0) {
  const idMap = new Map(), groupMap = new Map();
  const nodes = shapes.filter(s => s.type !== "connector").map(s => {
    const copy = { ...s, id: nextId() };
    idMap.set(s.id, copy.id);
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, nextId());
      copy.groupId = groupMap.get(copy.groupId);
    }
    if (dx || dy) translateShape(copy, dx, dy);
    return copy;
  });
  // Children point at their copied parent; a copied child whose parent wasn't copied keeps its old parent
  // until the caller re-parents by position.
  for (const n of nodes) if (n.parentId && idMap.has(n.parentId)) n.parentId = idMap.get(n.parentId);
  const connectors = shapes
    .filter(s => s.type === "connector" && idMap.has(s.fromId) && idMap.has(s.toId))
    .map(s => ({ ...s, id: nextId(), fromId: idMap.get(s.fromId), toId: idMap.get(s.toId) }));
  return [...nodes, ...connectors];
}
