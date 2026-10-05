/**
 * path.js
 * --------------------------------------------------------------------------
 * Geometry for vector paths (the Pen tool). A path is a list of nodes, each
 *     { x, y, hin: {x,y} | null, hout: {x,y} | null }
 * where hin/hout are the bezier handles as ABSOLUTE points (no handle = a
 * corner). Segment i runs from node i to node i+1 (and last -> first when the
 * path is closed); it's a straight line if neither end has a handle on that
 * side, otherwise a cubic bezier.
 *
 * Nodes are immutable by convention (history snapshots share them): every
 * function here returns NEW nodes and never edits in place.
 * -------------------------------------------------------------------------- */

const SAMPLES = 16; // line segments used to approximate each curve

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/** Each segment as { p0, c1, c2, p3, straight }. */
export function segments(nodes, closed) {
  const out = [], n = nodes.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    out.push({ p0: a, c1: a.hout || a, c2: b.hin || b, p3: b, straight: !a.hout && !b.hin });
  }
  return out;
}

const bezier = (s, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p3.x,
    y: u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p3.y,
  };
};

/** The path as a polyline (curves sampled), for hit-testing and bounds. */
export function flatten(nodes, closed) {
  if (!nodes.length) return [];
  const pts = [{ x: nodes[0].x, y: nodes[0].y }];
  for (const s of segments(nodes, closed)) {
    if (s.straight) pts.push({ x: s.p3.x, y: s.p3.y });
    else for (let i = 1; i <= SAMPLES; i++) pts.push(bezier(s, i / SAMPLES));
  }
  return pts;
}

/** Bounds of the drawn curve itself (handles that don't pull the curve out don't count). */
export function pathBounds(shape) {
  const pts = flatten(shape.nodes || [], shape.closed);
  if (!pts.length) return { x: shape.x || 0, y: shape.y || 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** SVG path data ("M … C … Z") — handy for an agent that wants to reproduce the shape exactly. */
export function pathToSvg(shape) {
  const nodes = shape.nodes || [];
  if (!nodes.length) return "";
  const f = (n) => Math.round(n * 100) / 100;
  let d = `M ${f(nodes[0].x)} ${f(nodes[0].y)}`;
  const segs = segments(nodes, shape.closed);
  // Z already draws a straight closing edge, so only a curved one needs spelling out.
  if (shape.closed && segs.length && segs[segs.length - 1].straight) segs.pop();
  for (const s of segs) {
    d += s.straight ? ` L ${f(s.p3.x)} ${f(s.p3.y)}` : ` C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
  }
  return shape.closed ? `${d} Z` : d;
}

/** Adds the path to the canvas context's current path (does not fill or stroke). */
export function tracePath(ctx, shape) {
  const nodes = shape.nodes || [];
  if (!nodes.length) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (const s of segments(nodes, shape.closed)) {
    if (s.straight) ctx.lineTo(s.p3.x, s.p3.y);
    else ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p3.x, s.p3.y);
  }
  if (shape.closed) ctx.closePath();
}

const shiftPoint = (p, f) => (p ? f(p) : null);

/** A new node list with every point (anchors and handles) run through `f`. */
export function mapNodes(nodes, f) {
  return nodes.map(n => {
    const a = f({ x: n.x, y: n.y });
    return { x: a.x, y: a.y, hin: shiftPoint(n.hin, f), hout: shiftPoint(n.hout, f) };
  });
}

export const translateNodes = (nodes, dx, dy) => mapNodes(nodes, p => ({ x: p.x + dx, y: p.y + dy }));

function segDistance(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

/** Hit-test: near the stroke, or inside a closed, filled path. */
export function hitTestPath(shape, px, py, tol) {
  const pts = flatten(shape.nodes || [], shape.closed);
  if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y) <= tol + shape.strokeWidth / 2;
  const reach = tol + shape.strokeWidth / 2;
  for (let i = 1; i < pts.length; i++) if (segDistance(px, py, pts[i - 1], pts[i]) <= reach) return true;
  return !!(shape.closed && (shape.fill || shape.gradient) && inPolygon(pts, px, py));
}

/** Which anchor or handle of an edited path is under (px, py)? -> { kind: "anchor"|"hin"|"hout", index } | null. Anchors win over handles. */
export function hitTestNodes(shape, px, py, reach) {
  const nodes = shape.nodes || [];
  for (let i = nodes.length - 1; i >= 0; i--) if (Math.hypot(px - nodes[i].x, py - nodes[i].y) <= reach) return { kind: "anchor", index: i };
  for (let i = nodes.length - 1; i >= 0; i--) {
    for (const kind of ["hin", "hout"]) {
      const h = nodes[i][kind];
      if (h && Math.hypot(px - h.x, py - h.y) <= reach) return { kind, index: i };
    }
  }
  return null;
}

/** The handle opposite `h` through `anchor` (what keeps a smooth node smooth). */
export const mirrorHandle = (anchor, h) => ({ x: 2 * anchor.x - h.x, y: 2 * anchor.y - h.y });

/** A new node list with node `i` replaced by `{...nodes[i], ...patch}`. */
export const withNode = (nodes, i, patch) => nodes.map((n, j) => (j === i ? { ...n, ...patch } : n));
