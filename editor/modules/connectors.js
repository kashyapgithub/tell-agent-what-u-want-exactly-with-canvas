/**
 * connectors.js
 * --------------------------------------------------------------------------
 * A connector is what makes this a flow-diagram tool rather than just a
 * drawing tool: it stores `fromId` / `toId`, never coordinates. Every render,
 * resolveRoute() looks up both shapes' *current* bounds and computes the path
 * between them. Drag either node and the arrow follows on the next frame —
 * nothing has to be told to update, because no position was ever stored.
 *
 * Two routings: "straight" (edge to edge along the line between centres) and
 * "elbow" (right-angle path, the usual look for architecture diagrams).
 * -------------------------------------------------------------------------- */

import { getWorldBounds, distanceToSegment } from "./shapes.js";

const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where a ray from `from`, aimed at `towards`, exits the rectangle `bounds`. */
function borderPoint(bounds, from, towards) {
  const dx = towards.x - from.x, dy = towards.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const halfW = bounds.w / 2 || 1, halfH = bounds.h / 2 || 1;
  const k = Math.min(Math.abs(halfW / (dx || 1e-6)), Math.abs(halfH / (dy || 1e-6)));
  return { x: from.x + dx * k, y: from.y + dy * k };
}

/** Right-angle route: leave through the facing side, jog at the midpoint, enter the facing side. */
function elbowRoute(fb, tb, fc, tc) {
  const dx = tc.x - fc.x, dy = tc.y - fc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? fb.x + fb.w : fb.x;
    const ex = dx >= 0 ? tb.x : tb.x + tb.w;
    const mid = (sx + ex) / 2;
    return [{ x: sx, y: fc.y }, { x: mid, y: fc.y }, { x: mid, y: tc.y }, { x: ex, y: tc.y }];
  }
  const sy = dy >= 0 ? fb.y + fb.h : fb.y;
  const ey = dy >= 0 ? tb.y : tb.y + tb.h;
  const mid = (sy + ey) / 2;
  return [{ x: fc.x, y: sy }, { x: fc.x, y: mid }, { x: tc.x, y: mid }, { x: tc.x, y: ey }];
}

/** The connector's path as a list of points, or null if either endpoint shape is gone. */
export function resolveRoute(connector, allShapes) {
  const from = allShapes.find(s => s.id === connector.fromId);
  const to = allShapes.find(s => s.id === connector.toId);
  if (!from || !to) return null;
  const fb = getWorldBounds(from), tb = getWorldBounds(to);
  const fc = centerOf(fb), tc = centerOf(tb);
  if (connector.route === "elbow") return elbowRoute(fb, tb, fc, tc);
  return [borderPoint(fb, fc, tc), borderPoint(tb, tc, fc)];
}

/** Draws a committed connector: path + arrowhead + optional label chip. */
export function drawConnector(ctx, connector, allShapes) {
  const route = resolveRoute(connector, allShapes);
  if (!route) return;
  ctx.save();
  ctx.globalAlpha = connector.opacity ?? 1;
  ctx.strokeStyle = connector.stroke;
  ctx.lineWidth = connector.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (connector.dashed) ctx.setLineDash([connector.strokeWidth * 3, connector.strokeWidth * 2]);
  tracePath(ctx, route);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, route, connector.strokeWidth);
  if (connector.label) drawLabel(ctx, labelPoint(route), connector.label, connector.stroke);
  ctx.restore();
}

/** Translucent highlight over a selected connector (it has no bounding box to outline). */
export function drawConnectorHighlight(ctx, connector, allShapes, scale = 1) {
  const route = resolveRoute(connector, allShapes);
  if (!route) return;
  ctx.save();
  ctx.strokeStyle = "#3a5bd9";
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = (connector.strokeWidth || 2) + 5 / scale;
  ctx.lineJoin = "round";
  tracePath(ctx, route);
  ctx.stroke();
  ctx.restore();
}

/** Dashed preview while a connector is being dragged out from `draft.fromId`. */
export function drawDraftConnector(ctx, draft, allShapes, scale = 1) {
  const from = allShapes.find(s => s.id === draft.fromId);
  if (!from) return;
  const b = getWorldBounds(from);
  const p1 = borderPoint(b, centerOf(b), { x: draft.toX, y: draft.toY });
  ctx.save();
  ctx.strokeStyle = "#3a5bd9";
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([5 / scale, 4 / scale]);
  tracePath(ctx, [p1, { x: draft.toX, y: draft.toY }]);
  ctx.stroke();
  ctx.restore();
}

/** True if (px,py) is within `tol` world units of any segment of the connector's route. */
export function hitTestConnector(connector, allShapes, px, py, tol = 6) {
  const route = resolveRoute(connector, allShapes);
  if (!route) return false;
  for (let i = 1; i < route.length; i++) {
    if (distanceToSegment(px, py, route[i - 1].x, route[i - 1].y, route[i].x, route[i].y) <= tol) return true;
  }
  return false;
}

// ---- drawing primitives -----------------------------------------------------

function tracePath(ctx, route) {
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y);
}

function drawArrowHead(ctx, route, strokeWidth) {
  // Use the last non-degenerate segment so a zero-length final jog can't spin the head.
  let a = route[route.length - 2], b = route[route.length - 1], i = route.length - 2;
  while (i > 0 && a.x === b.x && a.y === b.y) { i--; a = route[i - 1]; }
  const head = 8 + strokeWidth * 2;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

/** Middle of a straight route, or of the middle segment of an elbow route. */
function labelPoint(route) {
  const [a, b] = route.length === 2 ? [route[0], route[1]] : [route[1], route[2]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function drawLabel(ctx, at, label, color) {
  ctx.font = "12px -apple-system, sans-serif";
  const width = ctx.measureText(label).width;
  ctx.fillStyle = "#ffffff"; // opaque chip so the label reads over crossing lines
  ctx.fillRect(at.x - width / 2 - 4, at.y - 9, width + 8, 18);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, at.x, at.y);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
