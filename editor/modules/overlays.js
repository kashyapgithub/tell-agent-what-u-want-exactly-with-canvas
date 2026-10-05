/**
 * overlays.js
 * --------------------------------------------------------------------------
 * Editor-only annotations drawn on top of the scene at constant on-screen
 * size: the name labels above frames / sections / slices (click one to select
 * the frame, drag it to move the frame and everything in it). These never
 * appear in exports.
 * -------------------------------------------------------------------------- */

import { getBounds, layerLabel } from "./shapes.js";
import { tracePath } from "./path.js";

export const LABEL_TYPES = new Set(["frame", "section", "slice"]);

const LABEL_HEIGHT_PX = 16;
const labelWidthPx = (text) => text.length * 6.6 + 10; // approximate; the same figure is used to draw and to hit-test

/** World-space rectangle of a shape's name label (just above its top-left corner). */
export function labelRect(shape, scale) {
  const b = getBounds(shape);
  const h = LABEL_HEIGHT_PX / scale;
  return { x: b.x, y: b.y - h - 2 / scale, w: labelWidthPx(layerLabel(shape)) / scale, h };
}

export function hitLabel(shape, px, py, scale) {
  const r = labelRect(shape, scale);
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Draws the name above each visible frame/section/slice; accent-coloured when selected. */
export function drawFrameLabels(ctx, shapes, selectedIds, scale) {
  const sel = new Set(selectedIds);
  ctx.save();
  ctx.font = `${11 / scale}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  for (const s of shapes) {
    if (!LABEL_TYPES.has(s.type) || s.hidden) continue;
    const r = labelRect(s, scale);
    ctx.fillStyle = sel.has(s.id) ? "#3a5bd9" : s.type === "slice" ? "#e8690b" : "#8a8b93";
    ctx.fillText(layerLabel(s), r.x + 2 / scale, r.y + 2 / scale);
  }
  ctx.restore();
}

// ---- Comment pins ---------------------------------------------------------------

/** Document-order numbers for visible comments: id -> 1, 2, 3 … (the same numbers the export's `notes` use). */
export function commentNumbers(shapes) {
  const map = new Map();
  for (const s of shapes) if (s.type === "comment" && !s.hidden) map.set(s.id, map.size + 1);
  return map;
}

/**
 * Draws pins at constant on-screen size. Each item: { x, y, n, resolved, selected }.
 * The bubble floats above the anchor point and a small tail touches it.
 */
export function drawCommentPins(ctx, items, scale) {
  if (!items.length) return;
  const r = 13 / scale;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${11 / scale}px -apple-system, "Segoe UI", sans-serif`;
  ctx.lineWidth = 1.5 / scale;
  for (const it of items) {
    const cx = it.x, cy = it.y - r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.moveTo(cx - r * 0.45, cy + r * 0.9);
    ctx.lineTo(it.x, it.y);
    ctx.lineTo(cx + r * 0.1, cy + r);
    ctx.closePath();
    ctx.fillStyle = it.resolved ? "#c9cad1" : "#f24822";
    ctx.strokeStyle = it.selected ? "#3a5bd9" : "#ffffff";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = it.resolved ? "#6b6c75" : "#ffffff";
    ctx.fillText(String(it.n), cx, cy + 0.5 / scale);
  }
  ctx.restore();
}

// ---- Pen: the path being drawn, and node editing --------------------------------------

const ACCENT = "#3a5bd9";

function drawHandles(ctx, node, scale) {
  for (const h of [node.hin, node.hout]) {
    if (!h) continue;
    ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(h.x, h.y, 3.5 / scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function drawAnchor(ctx, node, scale, selected, big = false) {
  const r = (big ? 5 : 4) / scale;
  ctx.fillStyle = selected ? ACCENT : "#ffffff";
  ctx.beginPath();
  if (big) ctx.arc(node.x, node.y, r, 0, Math.PI * 2); else ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
  ctx.fill(); ctx.stroke();
}

/** The Pen path in progress: the curve so far, a live segment to the cursor, anchors and handles. */
export function drawDraftPath(ctx, draft, scale) {
  const nodes = draft.nodes;
  if (!nodes.length) return;
  ctx.save();
  ctx.strokeStyle = ACCENT; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 1.5 / scale; ctx.lineJoin = "round";
  const live = draft.preview ? [...nodes, { x: draft.preview.x, y: draft.preview.y, hin: null, hout: null }] : nodes;
  tracePath(ctx, { nodes: live, closed: false });
  ctx.stroke();
  ctx.lineWidth = 1 / scale;
  nodes.forEach((n, i) => { drawHandles(ctx, n, scale); drawAnchor(ctx, n, scale, false, i === 0 && nodes.length >= 2); }); // the big first point is the "close" target
  ctx.restore();
}

/** Anchors and bezier handles of the path being edited; the selected anchor is filled. */
export function drawPathEdit(ctx, shape, selectedIndex, scale) {
  ctx.save();
  ctx.strokeStyle = ACCENT; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 1 / scale;
  shape.nodes.forEach(n => drawHandles(ctx, n, scale));
  shape.nodes.forEach((n, i) => drawAnchor(ctx, n, scale, i === selectedIndex));
  ctx.restore();
}
