/**
 * tools.js
 * --------------------------------------------------------------------------
 * All pointer/keyboard interaction. Owns the mutable editor state (shape list,
 * selection, current tool) and calls `onChange` after anything visible changes.
 *
 * Selection is a list of ids (`state.selectedIds`, kept in z-order). The
 * derived `state.selection` (the shape objects) is refreshed on every notify.
 *
 * Every gesture has the same shape:
 *   pointerdown -> begin (`drag` records the start state)
 *   pointermove -> update from the *start* state + current pointer (stateless)
 *   pointerup   -> commit: exactly one undo step, and only if something changed
 *
 * Pointer positions arrive in world coordinates via `viewport`, and hit
 * tolerances are screen pixels divided by zoom, so it all feels the same at
 * any zoom level.
 * -------------------------------------------------------------------------- */

import {
  createShape, nextId, nextName, getBounds, getWorldBounds, hitTest, hitTestHandle, hitTestBoxHandles,
  normalizeShape, simplifyPoints, isRotatable,
} from "./shapes.js";
import { descendantsOf, topLevelOf, reparent, enforceHierarchy } from "./hierarchy.js";
import { moveShape, translateShape, resizeShape, rotateShape, resizeGroup } from "./transform.js";
import { scaleEffects } from "./effectsModel.js";
import { hitTestNodes, mirrorHandle, withNode } from "./path.js";
import { expandGroups, movableShapes, selectionBounds, topHit, shapesInRect } from "./selection.js";
import { collectSnapTargets, snapMove } from "./snapping.js";
import { alignShapes, distributeShapes } from "./align.js";
import { gatherWithConnectors, cloneShapes } from "./clipboard.js";
import { createHistory, pushHistory, undo, redo } from "./history.js";
import { CREATION_TOOLS } from "./toolRegistry.js";

const HIT_TOLERANCE_PX = 5;   // how close a click must be to hit a shape (screen px)
const SNAP_PX = 6;            // how close an edge must be to a guide to snap (screen px)
const PEN_MIN_STEP_PX = 2;    // freehand: ignore pointer moves shorter than this
const PEN_SIMPLIFY_PX = 0.8;  // freehand: tolerance when simplifying on release
const MIN_SHAPE_SIZE = 2;     // drags smaller than this are treated as accidental clicks
const PASTE_OFFSET = 16;
const READ_ONLY_TOOLS = new Set(["select", "hand", "comment"]); // what Dev mode still allows

const HANDLE_CURSORS = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  p1: "crosshair", p2: "crosshair", rot: "grab",
};

/** True when keystrokes belong to a text field (so Delete/Backspace/undo must not act on shapes). */
function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && ["text", "number", "search", "email", "url", "password"].includes(el.type);
}

export function createToolController({ canvasEl, textInputEl, viewport, onChange, onCommentRequest = () => {} }) {
  const state = {
    shapes: [],
    selectedIds: [],
    selection: [],        // derived from selectedIds on every notify
    draftShape: null,
    draftConnector: null, // { fromId, toX, toY } while dragging a new connector
    draftPath: null,      // { nodes, preview } while drawing with the Pen
    editPathId: null,     // the vector path whose anchors/handles are being edited
    editNode: null,       // index of the selected anchor while editing
    marquee: null,        // { x0, y0, x1, y1 } while box-selecting
    guides: [],           // smart-guide lines to draw while dragging
    currentTool: "select",
    style: {
      stroke: "#1b1c20", fill: null, strokeWidth: 2, cornerRadius: 0, opacity: 1,
      effects: [], gradient: null, fontSize: 18, dashed: false, route: "straight", count: 5, inner: 0.5,
    },
    readOnly: false,      // Dev mode: inspect only, nothing can be edited
    nameCounters: {},
    undoRevision: 0,      // bumps on undo/redo so panels know to rebuild from the restored state
  };

  const history = createHistory();
  let drag = null;
  let cursor = "";
  let editingText = false;
  let clipboard = [];
  let pasteCount = 0;

  // ---- selection ------------------------------------------------------------------

  /**
   * Sets the selection. `expand` pulls in whole groups; `toggle` adds/removes
   * `ids` instead of replacing (shift-click).
   */
  function select(ids, { expand = true, toggle = false } = {}) {
    let next = expand ? expandGroups(ids, state.shapes) : ids;
    if (toggle) {
      const current = new Set(state.selectedIds);
      const allIn = next.every(id => current.has(id));
      for (const id of next) { if (allIn) current.delete(id); else current.add(id); }
      next = [...current];
    }
    const wanted = new Set(next);
    state.selectedIds = state.shapes.filter(s => wanted.has(s.id)).map(s => s.id);
    notify();
  }

  const selectAll = () => select(state.shapes.filter(s => !s.hidden && !s.locked).map(s => s.id), { expand: false });

  // ---- public actions -------------------------------------------------------------

  function setTool(tool) {
    if (state.readOnly && !READ_ONLY_TOOLS.has(tool)) return;
    if (state.draftPath && tool !== "path") finishPath(false); // switching away keeps what you drew
    state.editPathId = null; state.editNode = null;
    state.currentTool = tool;
    if (CREATION_TOOLS.has(tool)) state.selectedIds = []; // Move/Hand/Scale keep your selection
    state.draftConnector = null;
    setCursor(tool === "select" || tool === "scale" ? "default" : tool === "hand" ? "grab" : tool === "text" ? "text" : "crosshair");
    notify();
  }

  /** Default style for the next shape drawn. */
  function setStyle(partial) {
    Object.assign(state.style, partial);
  }

  /** Applies a style patch live to every selected shape (the toolbar calls this alongside setStyle). */
  function updateSelectedStyle(partial) {
    if (!state.selection.length) return;
    for (const s of state.selection) Object.assign(s, partial);
    commitHistory();
  }

  /**
   * Edits the effects list. `fn` receives the current list (the first selected
   * shape's, or the default for new shapes when nothing is selected) and returns
   * a NEW list; the result is applied to every selected shape. Effects are
   * immutable — always build new objects — because undo snapshots share them.
   * Pass { commit: false } while a value is being dragged/typed, then commit once.
   */
  function setEffects(fn, { commit = true } = {}) {
    const sel = state.selection;
    if (!sel.length) { state.style.effects = fn(state.style.effects); notify(); return; }
    const next = fn(sel[0].effects || []);
    for (const s of sel) s.effects = next.slice();
    if (commit) commitHistory(); else notify();
  }

  function setSelectedRotation(deg) {
    const targets = state.selection.filter(s => isRotatable(s) && !s.locked);
    if (!targets.length) return;
    for (const s of targets) s.rotation = deg;
    commitHistory();
  }

  /** Puts shapes in whichever frame/section their centre sits in, and restores parent-before-children order. */
  function adopt(list) {
    reparent(state.shapes, list);
    state.shapes = enforceHierarchy(state.shapes);
  }

  function registerShape(shape) {
    if (!shape.name && shape.type !== "text") shape.name = nextName(shape.type, state.nameCounters);
  }

  function addShape(shape) {
    registerShape(shape);
    state.shapes.push(shape);
    adopt([shape]);
    state.selectedIds = [shape.id];
    commitHistory();
  }

  function clearAll() {
    state.shapes = [];
    state.selectedIds = [];
    commitHistory();
  }

  function restore(snapshot) {
    if (!snapshot) return;
    state.shapes = snapshot;
    state.undoRevision += 1;
    notify(); // prunes selectedIds that no longer exist
  }
  const undoAction = () => restore(undo(history));
  const redoAction = () => restore(redo(history));

  /** Deletes the selection — and any connectors attached to it, so none are left dangling. */
  function deleteSelected() {
    if (!state.selectedIds.length) return;
    // Deleting a frame deletes what is inside it.
    const gone = new Set([...state.selectedIds, ...descendantsOf(state.shapes, state.selectedIds).map(s => s.id)]);
    state.shapes = state.shapes.filter(s => !gone.has(s.id) && !gone.has(s.fromId) && !gone.has(s.toId));
    state.selectedIds = [];
    commitHistory();
  }

  function pasteClones(clones) {
    if (!clones.length) return;
    state.shapes.push(...clones);
    const cloneIds = new Set(clones.map(s => s.id));
    adopt(clones.filter(s => s.type !== "connector" && !cloneIds.has(s.parentId)));
    state.selectedIds = clones.filter(s => s.type !== "connector").map(s => s.id);
    commitHistory();
  }

  function duplicateSelected() {
    const source = gatherWithConnectors(state.selection, state.shapes);
    pasteClones(cloneShapes(source, PASTE_OFFSET, PASTE_OFFSET));
  }

  function copySelected() {
    const source = gatherWithConnectors(state.selection, state.shapes);
    if (!source.length) return;
    clipboard = source.map(s => ({ ...s }));
    pasteCount = 0;
  }

  function cutSelected() {
    copySelected();
    deleteSelected();
  }

  /** Pastes the internal clipboard, each paste offset a little further so copies don't hide each other. */
  function pasteShapes() {
    if (!clipboard.length || state.readOnly) return;
    pasteCount += 1;
    pasteClones(cloneShapes(clipboard, PASTE_OFFSET * pasteCount, PASTE_OFFSET * pasteCount));
  }

  function nudgeSelected(dx, dy) {
    const top = topLevelOf(movableShapes(state.selection), state.shapes);
    if (!top.length) return;
    const carried = descendantsOf(state.shapes, top.map(s => s.id)).filter(d => !d.locked);
    for (const s of [...top, ...carried]) translateShape(s, dx, dy);
    adopt(top);
    commitHistory();
  }

  /** Z-order for the whole selection: "forward" | "backward" | "front" | "back". */
  function reorderSelected(where) {
    if (!state.selectedIds.length) return;
    const sel = new Set(state.selectedIds), list = state.shapes;
    if (where === "front" || where === "back") {
      const picked = list.filter(s => sel.has(s.id)), rest = list.filter(s => !sel.has(s.id));
      state.shapes = where === "front" ? [...rest, ...picked] : [...picked, ...rest];
    } else if (where === "forward") {
      for (let i = list.length - 2; i >= 0; i--) if (sel.has(list[i].id) && !sel.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else {
      for (let i = 1; i < list.length; i++) if (sel.has(list[i].id) && !sel.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    state.shapes = enforceHierarchy(state.shapes);
    commitHistory();
  }

  // ---- arrange: align / distribute / group -----------------------------------------

  /**
   * Runs an arrangement (align/distribute) on the top-level selected shapes, then
   * moves whatever is inside any frame that moved by the same amount.
   */
  function arrange(run) {
    const top = topLevelOf(movableShapes(state.selection), state.shapes);
    const before = new Map(top.map(s => [s.id, getWorldBounds(s)]));
    if (!run(top)) return;
    for (const s of top) {
      const a = before.get(s.id), b = getWorldBounds(s), dx = b.x - a.x, dy = b.y - a.y;
      if (dx || dy) for (const d of descendantsOf(state.shapes, [s.id])) if (!d.locked) translateShape(d, dx, dy);
    }
    adopt(top);
    commitHistory();
  }

  const alignSelected = (mode) => arrange(items => alignShapes(items, mode));
  const distributeSelected = (axis) => arrange(items => distributeShapes(items, axis));

  /** Ctrl/Cmd+Alt+G: wrap the selection in a new frame sized to fit it. */
  function frameSelection() {
    const nodes = topLevelOf(state.selection.filter(s => s.type !== "connector"), state.shapes);
    if (!nodes.length) return;
    const b = selectionBounds(nodes);
    const frame = createShape("frame", {
      x: b.x, y: b.y, w: b.w, h: b.h, fill: "#ffffff", stroke: "#d4d4d9", strokeWidth: 1, clip: true,
      parentId: nodes[0].parentId ?? null,
    });
    registerShape(frame);
    state.shapes.splice(Math.min(...nodes.map(n => state.shapes.indexOf(n))), 0, frame);
    for (const n of nodes) n.parentId = frame.id;
    state.shapes = enforceHierarchy(state.shapes);
    state.selectedIds = [frame.id];
    commitHistory();
  }

  function groupSelected() {
    const nodes = state.selection.filter(s => s.type !== "connector");
    if (nodes.length < 2) return;
    const groupId = nextId();
    for (const s of nodes) s.groupId = groupId;
    commitHistory();
  }

  function ungroupSelected() {
    const grouped = state.selection.filter(s => s.groupId);
    if (!grouped.length) return;
    for (const s of grouped) s.groupId = null;
    commitHistory();
  }

  // ---- layers ---------------------------------------------------------------------

  function toggleHidden(id) {
    const s = state.shapes.find(x => x.id === id);
    if (!s) return;
    s.hidden = !s.hidden;
    if (s.hidden) state.selectedIds = state.selectedIds.filter(x => x !== id);
    commitHistory();
  }

  function toggleLocked(id) {
    const s = state.shapes.find(x => x.id === id);
    if (!s) return;
    s.locked = !s.locked;
    commitHistory();
  }

  function renameShape(id, name) {
    const s = state.shapes.find(x => x.id === id);
    if (!s || s.name === name.trim()) return;
    s.name = name.trim();
    commitHistory();
  }

  /** Moves `dragId` (and the rest of the selection, if it's part of it) directly above `targetId` in z-order. */
  function moveLayer(dragId, targetId) {
    const moving = new Set(state.selectedIds.includes(dragId) ? state.selectedIds : [dragId]);
    if (moving.has(targetId)) return;
    const target = state.shapes.find(s => s.id === targetId);
    // A layer can't be dropped into something it contains.
    if (target && descendantsOf(state.shapes, [...moving]).some(d => d.id === targetId)) return;
    const picked = state.shapes.filter(s => moving.has(s.id));
    const rest = state.shapes.filter(s => !moving.has(s.id));
    const at = rest.findIndex(s => s.id === targetId);
    if (at < 0) return;
    rest.splice(at + 1, 0, ...picked);
    for (const p of picked) if (p.type !== "slice") p.parentId = target.parentId ?? null; // dropped beside the target: same container
    state.shapes = enforceHierarchy(rest);
    commitHistory();
  }

  // ---- pointer handling ---------------------------------------------------------------

  const toMap = (items) => new Map(items.map(s => [s.id, { ...s }]));

  function onPointerDown(evt) {
    if (evt.button > 0) return; // left button / touch only; middle-click pans (viewportControls)
    const pt = viewport.toWorld(evt.clientX, evt.clientY);
    switch (state.currentTool) {
      case "select":
      case "scale": return startSelectOrDrag(pt, evt);
      case "text": evt.preventDefault?.(); return openTextInput(pt.x, pt.y, null);
      case "connector": return startConnector(pt);
      case "path": evt.preventDefault?.(); return startPathNode(pt);
      case "comment": evt.preventDefault?.(); return onCommentRequest(pt); // the page opens the comment box at this point
      default: return startNewShape(pt);
    }
  }

  function onPointerMove(evt) {
    const pt = viewport.toWorld(evt.clientX, evt.clientY);
    if (!drag) {
      if (state.draftPath) { state.draftPath.preview = pt; notify(); } // rubber-band line to the cursor
      updateHoverCursor(pt);
      return;
    }

    switch (drag.mode) {
      case "move": updateMove(pt, evt); break;
      case "resize":
        resizeShape(drag.shape, drag.orig, drag.handle, pt.x, pt.y, evt.shiftKey);
        drag.changed = true;
        break;
      case "rotate":
        rotateShape(drag.shape, drag.orig, pt.x, pt.y, evt.shiftKey);
        drag.changed = true;
        break;
      case "scale": {
        // Proportional scale of EVERYTHING: geometry, stroke width, corner radius, font size, effect sizes.
        const { sx, sy } = resizeGroup(drag.items, drag.origs, drag.origBounds, drag.handle, pt.x, pt.y, true);
        const f = (sx + sy) / 2;
        for (const s of drag.items) {
          const o = drag.origs.get(s.id);
          s.strokeWidth = o.strokeWidth * f;
          if (o.cornerRadius) s.cornerRadius = o.cornerRadius * f;
          if (o.effects && o.effects.length) s.effects = scaleEffects(o.effects, f);
        }
        drag.changed = true;
        break;
      }
      case "groupResize":
        resizeGroup(drag.items, drag.origs, drag.origBounds, drag.handle, pt.x, pt.y, evt.shiftKey);
        drag.changed = true;
        break;
      case "marquee": updateMarquee(pt); break;
      case "pathNode": {
        // Dragging right after placing a node pulls out symmetric bezier handles (a smooth point).
        const n = drag.node;
        if (Math.hypot(pt.x - drag.startX, pt.y - drag.startY) > 3 / viewport.getScale()) {
          n.hout = { x: pt.x, y: pt.y };
          n.hin = mirrorHandle(n, n.hout);
        }
        break;
      }
      case "pathEdit": updatePathEdit(pt, evt); break;
      case "draw": updateDraftShape(drag, pt, evt.shiftKey); break;
      case "connector":
        state.draftConnector.toX = pt.x;
        state.draftConnector.toY = pt.y;
        break;
    }
    notify();
  }

  function onPointerUp() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    state.guides = [];

    if (finished.mode === "marquee") { state.marquee = null; notify(); return; }
    if (finished.mode === "pathNode") { notify(); return; } // the path is only committed when finished

    let changed = finished.changed;
    if (finished.mode === "draw") { changed = finishDraw(finished.shape); state.draftShape = null; }
    else if (finished.mode === "connector") changed = finishConnector();
    else if (finished.mode === "move" && !changed && finished.collapseTo) {
      // A plain click on one member of a multi-selection narrows the selection to it.
      select([finished.collapseTo.id]);
      return;
    }

    if (finished.mode === "move" && changed) adopt(finished.top); // dropped into / out of a frame?

    // A plain click (nothing actually changed) must not create an undo step.
    if (changed) commitHistory(); else notify();
  }

  // ---- select tool ----------------------------------------------------------------

  /** Which handle is under the pointer: a single shape's, or the box around a multi-selection. */
  function handleAt(pt) {
    const scale = viewport.getScale(), sel = state.selection;
    if (state.currentTool === "scale") {
      // The Scale tool always works on the box around the selection, and carries what's inside frames with it.
      const top = topLevelOf(movableShapes(sel), state.shapes);
      if (!top.length) return null;
      const items = [...top, ...descendantsOf(state.shapes, top.map(s => s.id)).filter(d => !d.locked)];
      const bounds = selectionBounds(top);
      const id = hitTestBoxHandles(bounds, pt.x, pt.y, scale);
      return id ? { kind: "scale", id, items, bounds } : null;
    }
    if (sel.length === 1 && sel[0].type !== "connector") {
      if (sel[0].locked) return null;
      const id = hitTestHandle(sel[0], pt.x, pt.y, scale);
      return id ? { kind: "single", id } : null;
    }
    if (sel.length > 1) {
      const items = movableShapes(sel);
      if (!items.length) return null;
      const bounds = selectionBounds(items);
      const id = hitTestBoxHandles(bounds, pt.x, pt.y, scale);
      return id ? { kind: "group", id, items, bounds } : null;
    }
    return null;
  }

  function startSelectOrDrag(pt, evt) {
    if (state.editPathId && !state.readOnly) {
      const path = state.shapes.find(s => s.id === state.editPathId);
      const node = path && hitTestNodes(path, pt.x, pt.y, 7 / viewport.getScale());
      if (node) {
        state.editNode = node.index;
        drag = { mode: "pathEdit", shapeId: path.id, kind: node.kind, index: node.index, orig: { ...path }, startX: pt.x, startY: pt.y, changed: false };
        notify();
        return;
      }
      state.editPathId = null; state.editNode = null; // clicking elsewhere ends node editing
    }
    const handle = state.readOnly ? null : handleAt(pt); // no resize/rotate handles in Dev mode
    if (handle) {
      if (handle.kind === "scale") {
        drag = { mode: "scale", items: handle.items, origs: toMap(handle.items), origBounds: handle.bounds, handle: handle.id, changed: false };
      } else if (handle.kind === "single") {
        const shape = state.selection[0];
        drag = { mode: handle.id === "rot" ? "rotate" : "resize", shape, orig: { ...shape }, handle: handle.id, changed: false };
      } else {
        drag = { mode: "groupResize", items: handle.items, origs: toMap(handle.items), origBounds: handle.bounds, handle: handle.id, changed: false };
      }
      return;
    }

    const hit = topHit(state.shapes, pt.x, pt.y, HIT_TOLERANCE_PX / viewport.getScale(), viewport.getScale());

    if (!hit) {
      if (!evt.shiftKey) state.selectedIds = [];
      state.marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      drag = { mode: "marquee", base: [...state.selectedIds], changed: false };
      notify();
      return;
    }

    let collapseTo = null;
    if (evt.shiftKey) {
      select([hit.id], { toggle: true });
      if (!state.selectedIds.includes(hit.id)) return; // it was toggled off — nothing to drag
    } else if (state.selectedIds.includes(hit.id)) {
      collapseTo = hit; // keep the multi-selection so it can be dragged as one unit
    } else {
      select([hit.id]);
    }
    if (!state.readOnly) beginMove(pt, collapseTo); // Dev mode selects but never drags
  }

  function beginMove(pt, collapseTo) {
    // Moving a frame carries everything inside it; if a frame and its contents are both selected, the frame wins.
    const top = topLevelOf(movableShapes(state.selection), state.shapes);
    if (!top.length) return; // e.g. only a connector is selected — selectable, not draggable
    const carried = descendantsOf(state.shapes, top.map(s => s.id)).filter(d => !d.locked);
    const items = [...top, ...carried];
    drag = {
      mode: "move", items, top, origs: toMap(items), startX: pt.x, startY: pt.y,
      origBounds: selectionBounds(top),
      snapTargets: collectSnapTargets(state.shapes, new Set(items.map(s => s.id))),
      collapseTo, changed: false,
    };
  }

  /** Moves the selection; Shift locks to an axis, Ctrl/Cmd disables snapping. */
  function updateMove(pt, evt) {
    let dx = pt.x - drag.startX, dy = pt.y - drag.startY;
    if (evt.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }

    state.guides = [];
    if (!(evt.ctrlKey || evt.metaKey) && drag.origBounds) {
      const box = { ...drag.origBounds, x: drag.origBounds.x + dx, y: drag.origBounds.y + dy };
      const snap = snapMove(box, drag.snapTargets, SNAP_PX / viewport.getScale());
      if (!evt.shiftKey || dx !== 0) dx += snap.dx;
      if (!evt.shiftKey || dy !== 0) dy += snap.dy;
      state.guides = snap.guides;
    }
    for (const s of drag.items) moveShape(s, drag.origs.get(s.id), dx, dy);
    drag.changed = dx !== 0 || dy !== 0;
  }

  function updateMarquee(pt) {
    const m = state.marquee;
    m.x1 = pt.x; m.y1 = pt.y;
    const rect = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
    // A bare click on empty canvas isn't a selection box — wait until it's actually dragged out a little.
    const big = rect.w >= 3 || rect.h >= 3;
    const hits = big ? expandGroups(shapesInRect(state.shapes, rect), state.shapes) : [];
    const wanted = new Set([...drag.base, ...hits]);
    state.selectedIds = state.shapes.filter(s => wanted.has(s.id)).map(s => s.id);
  }

  function updateHoverCursor(pt) {
    if (viewport.panMode) return; // the viewport controls own the cursor while pan-ready
    let next = state.currentTool === "text" ? "text" : "crosshair";
    if (state.currentTool === "select" || state.currentTool === "scale") {
      next = "default";
      const handle = handleAt(pt);
      if (handle) next = HANDLE_CURSORS[handle.id] || "default";
      else if (topHit(state.shapes, pt.x, pt.y, HIT_TOLERANCE_PX / viewport.getScale(), viewport.getScale())) next = "move";
    }
    setCursor(next);
  }

  function setCursor(next) {
    if (next === cursor || !canvasEl.style) return;
    cursor = next;
    canvasEl.style.cursor = next;
  }

  // ---- drawing tools -------------------------------------------------------------

  function startNewShape(pt) {
    const st = state.style;
    const style = {
      stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth, cornerRadius: st.cornerRadius,
      opacity: st.opacity, effects: st.effects.slice(), gradient: st.gradient, dashed: st.dashed,
    };
    let shape;
    switch (state.currentTool) {
      case "rect":
      case "ellipse":
      case "polygon":
      case "star":
        shape = createShape(state.currentTool, { x: pt.x, y: pt.y, count: st.count, inner: st.inner, ...style });
        break;
      case "frame":
        shape = createShape("frame", { x: pt.x, y: pt.y, fill: "#ffffff", stroke: "#d4d4d9", strokeWidth: 1, clip: true });
        break;
      case "section":
        shape = createShape("section", { x: pt.x, y: pt.y, fill: "#efeff2", stroke: "#d4d4d9", strokeWidth: 1 });
        break;
      case "slice":
        shape = createShape("slice", { x: pt.x, y: pt.y, stroke: "#ff7a1a", strokeWidth: 1, dashed: true });
        break;
      case "line":
      case "arrow":
        shape = createShape(state.currentTool, { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, ...style });
        break;
      case "pen":
        shape = createShape("pen", { points: [{ x: pt.x, y: pt.y }], ...style });
        break;
      default:
        return;
    }
    state.draftShape = shape;
    state.selectedIds = [];
    drag = { mode: "draw", shape, startX: pt.x, startY: pt.y, changed: false };
  }

  /** Grows the draft shape toward the pointer. Shift: square/circle, or 45° snapping for lines. */
  function updateDraftShape(d, pt, shift) {
    const shape = d.shape;
    let dx = pt.x - d.startX, dy = pt.y - d.startY;

    switch (shape.type) {
      case "rect":
      case "ellipse":
      case "polygon":
      case "star":
      case "frame":
      case "section":
      case "slice":
        if (shift) {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m;
        }
        shape.x = d.startX; shape.y = d.startY; shape.w = dx; shape.h = dy;
        break;
      case "line":
      case "arrow":
        if (shift) {
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          dx = Math.cos(angle) * len; dy = Math.sin(angle) * len;
        }
        shape.x2 = d.startX + dx; shape.y2 = d.startY + dy;
        break;
      case "pen": {
        const last = shape.points[shape.points.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) >= PEN_MIN_STEP_PX / viewport.getScale()) {
          shape.points.push({ x: pt.x, y: pt.y });
        }
        break;
      }
    }
  }

  /** Commits the draft if it has a real extent. Returns whether a shape was added. */
  function finishDraw(shape) {
    normalizeShape(shape);
    if (shape.type === "pen") {
      shape.points = simplifyPoints(shape.points, PEN_SIMPLIFY_PX / viewport.getScale());
      if (shape.points.length < 2) return false;
    } else {
      const b = getBounds(shape);
      if (b.w <= MIN_SHAPE_SIZE && b.h <= MIN_SHAPE_SIZE) return false;
    }
    registerShape(shape);
    state.shapes.push(shape);
    adopt([shape]);
    state.selectedIds = [shape.id];
    return true;
  }

  // ---- pen (vector paths) -----------------------------------------------------------

  /** Click adds a corner point; click-drag adds a smooth point; clicking the first point closes the path. */
  function startPathNode(pt) {
    let dp = state.draftPath;
    if (dp && dp.nodes.length >= 2 && Math.hypot(pt.x - dp.nodes[0].x, pt.y - dp.nodes[0].y) <= 8 / viewport.getScale()) {
      finishPath(true);
      return;
    }
    if (!dp) dp = state.draftPath = { nodes: [], preview: null };
    const node = { x: pt.x, y: pt.y, hin: null, hout: null };
    dp.nodes.push(node);
    drag = { mode: "pathNode", node, startX: pt.x, startY: pt.y, changed: false };
    notify();
  }

  /** Turns the in-progress pen path into a shape (open, or closed if `close`). Fewer than 2 points = discarded. */
  function finishPath(close) {
    const dp = state.draftPath;
    state.draftPath = null;
    if (!dp) return;
    const nodes = dp.nodes.slice();
    // A double-click lands two nodes on the same spot — drop the duplicate.
    while (nodes.length > 1 && Math.hypot(nodes.at(-1).x - nodes.at(-2).x, nodes.at(-1).y - nodes.at(-2).y) < 1) nodes.pop();
    if (nodes.length < 2) { notify(); return; }
    const st = state.style;
    const shape = createShape("path", {
      nodes: nodes.map(n => ({ ...n })), closed: !!close, fill: close ? (st.fill || "#d9d9d9") : null,
      stroke: st.stroke, strokeWidth: st.strokeWidth, opacity: st.opacity, effects: st.effects.slice(), dashed: st.dashed,
    });
    registerShape(shape);
    state.shapes.push(shape);
    adopt([shape]);
    state.selectedIds = [shape.id];
    commitHistory();
  }

  /** Dragging an anchor moves it with its handles; dragging a handle mirrors the opposite one (Alt breaks the symmetry). */
  function updatePathEdit(pt, evt) {
    const shape = state.shapes.find(s => s.id === drag.shapeId);
    if (!shape) return;
    const o = drag.orig, i = drag.index, n = o.nodes[i];
    if (drag.kind === "anchor") {
      const dx = pt.x - drag.startX, dy = pt.y - drag.startY;
      const move = (h) => h && { x: h.x + dx, y: h.y + dy };
      shape.nodes = withNode(o.nodes, i, { x: n.x + dx, y: n.y + dy, hin: move(n.hin), hout: move(n.hout) }); // a NEW array each frame
    } else {
      const other = drag.kind === "hout" ? "hin" : "hout", h = { x: pt.x, y: pt.y };
      shape.nodes = withNode(o.nodes, i, { [drag.kind]: h, [other]: evt.altKey ? n[other] : mirrorHandle(n, h) });
    }
    drag.changed = true;
  }

  /** Delete while editing nodes removes the selected anchor (or the whole path if too few remain). */
  function deleteEditNode() {
    const shape = state.shapes.find(s => s.id === state.editPathId);
    if (!shape || state.editNode == null) return false;
    if (shape.nodes.length <= 2) { state.selectedIds = [shape.id]; state.editPathId = null; deleteSelected(); return true; }
    shape.nodes = shape.nodes.filter((_, j) => j !== state.editNode);
    state.editNode = null;
    commitHistory();
    return true;
  }

  // ---- flow connectors -----------------------------------------------------------

  const nodeAt = (pt, exceptId = null) => {
    const tol = HIT_TOLERANCE_PX / viewport.getScale();
    return [...state.shapes].reverse()
      .find(s => s.type !== "connector" && !s.hidden && s.id !== exceptId && hitTest(s, pt.x, pt.y, tol));
  };

  /** Starts dragging out a connector — must begin on an existing shape. */
  function startConnector(pt) {
    const hit = nodeAt(pt);
    if (!hit) return;
    state.draftConnector = { fromId: hit.id, toX: pt.x, toY: pt.y };
    drag = { mode: "connector", changed: false };
    notify();
  }

  function finishConnector() {
    const { fromId, toX, toY } = state.draftConnector;
    state.draftConnector = null;
    const target = nodeAt({ x: toX, y: toY }, fromId);
    if (!target) return false;
    const connector = createShape("connector", {
      fromId, toId: target.id, label: "", route: state.style.route,
      stroke: state.style.stroke, strokeWidth: state.style.strokeWidth, dashed: state.style.dashed,
    });
    registerShape(connector);
    state.shapes.push(connector);
    state.selectedIds = [connector.id];
    return true;
  }

  // ---- text -----------------------------------------------------------------------------

  /**
   * Opens the overlay <input> at a world position. With `existing`, edits that
   * text shape in place (emptying it deletes it); otherwise creates a new one.
   */
  function openTextInput(worldX, worldY, existing) {
    if (editingText) return;
    editingText = true;

    const fontSize = existing ? existing.fontSize : state.style.fontSize;
    const at = viewport.toScreen(worldX, worldY);
    textInputEl.classList.remove("hidden");
    textInputEl.style.left = `${at.x}px`;
    textInputEl.style.top = `${at.y}px`;
    textInputEl.style.fontSize = `${fontSize * viewport.getScale()}px`;
    textInputEl.style.color = existing ? existing.stroke : state.style.stroke;
    textInputEl.value = existing ? existing.text : "";

    let cancelled = false;
    const finish = () => {
      textInputEl.removeEventListener("blur", finish);
      textInputEl.removeEventListener("keydown", onKey);
      textInputEl.classList.add("hidden");
      editingText = false;
      if (cancelled) return;

      const value = textInputEl.value.trim();
      if (existing) {
        if (!value) { state.selectedIds = [existing.id]; deleteSelected(); }
        else if (value !== existing.text) { existing.text = value; commitHistory(); }
      } else if (value) {
        addShape(createShape("text", {
          x: worldX, y: worldY, text: value, fontSize,
          stroke: state.style.stroke, opacity: state.style.opacity,
        }));
      }
    };
    const onKey = (e) => {
      if (e.key === "Enter") textInputEl.blur();
      if (e.key === "Escape") { cancelled = true; textInputEl.blur(); }
    };
    textInputEl.addEventListener("blur", finish);
    textInputEl.addEventListener("keydown", onKey);

    // Focus after the current pointer event finishes; focusing inside pointerdown
    // can lose the race against the browser's own focus handling.
    setTimeout(() => textInputEl.focus(), 0);
  }

  /** Double-click: enter a group, edit a text in place, or label a connector. */
  function onDoubleClick(evt) {
    if (state.readOnly) return;
    if (state.draftPath) { finishPath(false); return; }
    const sel = state.selection;
    if (sel.length === 1 && sel[0].type === "path") { state.editPathId = sel[0].id; state.editNode = null; notify(); return; }
    if (sel.length > 1) { // "enter" the group: narrow to the member that was clicked
      const pt = viewport.toWorld(evt.clientX, evt.clientY);
      const hit = topHit(state.shapes, pt.x, pt.y, HIT_TOLERANCE_PX / viewport.getScale(), viewport.getScale());
      if (hit) select([hit.id], { expand: false });
      return;
    }
    if (sel.length !== 1) return;
    const shape = sel[0];
    if (shape.type === "text") { openTextInput(shape.x, shape.y, shape); return; }
    if (shape.type === "connector") {
      const label = window.prompt("Connector label", shape.label || "");
      if (label === null) return;
      shape.label = label;
      commitHistory();
    }
  }

  // ---- keyboard -------------------------------------------------------------------------

  function onKeyDown(e) {
    if (isTextEntry(document.activeElement)) return; // let text fields keep their own shortcuts
    const meta = e.ctrlKey || e.metaKey;
    const key = e.key, lower = key.toLowerCase();

    if (state.readOnly) { // Dev mode: look, select, copy — nothing else
      if (meta && lower === "a") { e.preventDefault(); selectAll(); }
      else if (meta && lower === "c") copySelected();
      else if (key === "Escape") { state.selectedIds = []; notify(); }
      return;
    }

    if (state.draftPath) { // drawing with the Pen
      if (key === "Enter" || key === "Escape") { e.preventDefault(); finishPath(false); return; }
      if (key === "Backspace" || key === "Delete") { // remove the last point
        e.preventDefault();
        state.draftPath.nodes.pop();
        if (!state.draftPath.nodes.length) state.draftPath = null;
        notify();
        return;
      }
    }
    if (state.editPathId) { // editing a path's nodes
      if (key === "Escape") { e.preventDefault(); state.editPathId = null; state.editNode = null; notify(); return; }
      if ((key === "Delete" || key === "Backspace") && deleteEditNode()) { e.preventDefault(); return; }
    }
    if (key === "Enter" && state.selection.length === 1 && state.selection[0].type === "path") {
      e.preventDefault(); state.editPathId = state.selection[0].id; state.editNode = null; notify(); return;
    }
    if (meta && lower === "z") { e.preventDefault(); if (e.shiftKey) redoAction(); else undoAction(); return; }
    if (meta && lower === "y") { e.preventDefault(); redoAction(); return; }
    if (meta && lower === "a") { e.preventDefault(); selectAll(); return; }
    if (meta && lower === "d") { e.preventDefault(); duplicateSelected(); return; }
    if (meta && e.altKey && (lower === "g" || e.code === "KeyG")) { e.preventDefault(); frameSelection(); return; }
    if (meta && lower === "g") { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if (meta && lower === "c") { copySelected(); return; }            // paste arrives via the 'paste' event
    if (meta && lower === "x") { e.preventDefault(); cutSelected(); return; }
    if (meta && e.shiftKey && lower === "l") { e.preventDefault(); state.selection.forEach(s => toggleLocked(s.id)); return; }
    if (meta && e.shiftKey && lower === "h") { e.preventDefault(); [...state.selection].forEach(s => toggleHidden(s.id)); return; }
    if (meta && (key === "]" || key === "}")) { e.preventDefault(); reorderSelected(e.shiftKey ? "front" : "forward"); return; }
    if (meta && (key === "[" || key === "{")) { e.preventDefault(); reorderSelected(e.shiftKey ? "back" : "backward"); return; }

    if (key === "Delete" || key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
    if (key === "Escape") { state.selectedIds = []; state.draftConnector = null; state.marquee = null; drag = null; notify(); return; }

    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    // Arrow keys belong to a focused slider/dropdown (they change its value) — don't also nudge the shape.
    const focus = document.activeElement;
    if (focus && (focus.tagName === "SELECT" || (focus.tagName === "INPUT" && focus.type === "range"))) return;
    if (arrows[key] && state.selection.length) { e.preventDefault(); nudgeSelected(...arrows[key]); }
  }

  // ---- plumbing ---------------------------------------------------------------------------

  function commitHistory() {
    pushHistory(history, state.shapes);
    notify();
  }

  function notify() {
    const wanted = new Set(state.selectedIds);
    state.selection = state.shapes.filter(s => wanted.has(s.id));
    state.selectedIds = state.selection.map(s => s.id); // drops ids that no longer exist
    if (state.editPathId && !wanted.has(state.editPathId)) { state.editPathId = null; state.editNode = null; }
    onChange(state);
  }

  canvasEl.addEventListener("pointerdown", onPointerDown);
  canvasEl.addEventListener("pointermove", onPointerMove);
  canvasEl.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);

  /** Dev mode on/off. Turning it on finishes any pen path and drops to a tool that's allowed. */
  function setReadOnly(on) {
    if (on) { finishPath(false); state.editPathId = null; state.editNode = null; }
    state.readOnly = !!on;
    if (on && !READ_ONLY_TOOLS.has(state.currentTool)) setTool("select");
    else notify();
  }

  /**
   * In Dev mode every editing action becomes a no-op — whichever panel, shortcut or
   * command it comes from. Comments are the exception (Figma allows commenting in
   * Dev mode): adding, editing, resolving and deleting pins still works.
   */
  const onlyComments = () => state.selection.length > 0 && state.selection.every(s => s.type === "comment");
  const edits = (fn, { comments = false } = {}) => (...args) => {
    if (state.readOnly && !(comments && onlyComments())) return undefined;
    return fn(...args);
  };

  pushHistory(history, state.shapes); // seed with the empty initial state

  return {
    state, select, selectAll, setTool, setStyle, setReadOnly, finishPath,
    updateSelectedStyle: edits(updateSelectedStyle, { comments: true }),
    setEffects: edits(setEffects),
    setSelectedRotation: edits(setSelectedRotation),
    addShape: (shape) => (state.readOnly && shape.type !== "comment" ? undefined : addShape(shape)),
    clearAll: edits(clearAll),
    undoAction: edits(undoAction), redoAction: edits(redoAction),
    deleteSelected: edits(deleteSelected, { comments: true }),
    duplicateSelected: edits(duplicateSelected), copySelected, cutSelected: edits(cutSelected), pasteShapes,
    nudgeSelected: edits(nudgeSelected), reorderSelected: edits(reorderSelected),
    alignSelected: edits(alignSelected), distributeSelected: edits(distributeSelected),
    groupSelected: edits(groupSelected), ungroupSelected: edits(ungroupSelected), frameSelection: edits(frameSelection),
    toggleHidden: edits(toggleHidden), toggleLocked: edits(toggleLocked),
    renameShape: edits(renameShape), moveLayer: edits(moveLayer),
  };
}
