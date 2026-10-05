/**
 * shapes.js
 * --------------------------------------------------------------------------
 * The shape data model shared by every other module, plus the pure functions
 * that operate on a single shape: bounds, hit testing, drawing, selection
 * handles, point simplification.
 *
 * A shape is always a plain, serializable object — never a class instance —
 * because the exact same list is what gets exported as JSON for the agent.
 *
 * {
 *   id, type: "rect" | "ellipse" | "line" | "arrow" | "connector" | "pen" | "text" | "image",
 *   x, y, w, h,            // box shapes (rect / ellipse / image)
 *   x1, y1, x2, y2,        // line / arrow
 *   points: [{x,y}],       // pen
 *   text, fontSize,        // text (x,y = top-left; size is measured, not stored)
 *   src,                   // image: data: URL
 *   stroke, fill, strokeWidth,
 *   cornerRadius,          // rect only
 *   opacity,               // 0-1, every type
 *   gradient               // rect / ellipse only
 *   effects                // ordered list: drop/inner shadow, blurs, noise, texture, glass, shader (see effectsModel.js)
 * }
 * -------------------------------------------------------------------------- */

import { drawWithEffects } from "./effects.js";
import { effectsExtent, hasVisibleEffects } from "./effectsModel.js";
import { pathBounds, hitTestPath, tracePath } from "./path.js";

const ACCENT = "#3a5bd9";
let idCounter = 0;

export function nextId() {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter}`;
}

/** Creates a shape with defaults, overridden by `overrides`. */
export function createShape(type, overrides = {}) {
  return {
    id: nextId(),
    type,
    x: 0, y: 0, w: 0, h: 0,
    points: [],
    x1: 0, y1: 0, x2: 0, y2: 0,
    text: "",
    fontSize: 18,
    src: null,
    stroke: "#1b1c20",
    fill: null,
    strokeWidth: 2,
    cornerRadius: 0,
    opacity: 1,
    effects: [],
    gradient: null,
    nodes: [],                // path: [{ x, y, hin, hout }] (see path.js)
    closed: false,            // path: closed shapes can be filled
    clip: false,              // frames: clip children to the frame
    parentId: null,           // id of the containing frame/section (see hierarchy.js)
    count: 5,                 // polygon sides / star points
    inner: 0.5,               // star: inner radius as a fraction of the outer one
    dashed: false,
    rotation: 0,              // degrees; rect / ellipse / image / text
    route: "straight",        // connectors: "straight" | "elbow"
    name: "",                 // layer name ("" = derive from type / text)
    hidden: false,
    locked: false,
    groupId: null,            // shapes sharing a groupId move/select together
    ...overrides,
  };
}

// ---- Image bitmap cache -----------------------------------------------------
// Decoding a data: URL into a drawable <img> is async, so each distinct src is
// decoded once and kept here, however many frames are rendered.

const imageCache = new Map(); // src -> HTMLImageElement

/** Starts loading any "image" shape not yet cached; `onLoaded` fires per image when ready. */
export function preloadShapeImages(shapes, onLoaded) {
  for (const shape of shapes) {
    if (shape.type !== "image" || !shape.src || imageCache.has(shape.src)) continue;
    const img = new Image();
    imageCache.set(shape.src, img);
    img.onload = () => onLoaded();
    img.src = shape.src;
  }
}

// ---- Text measuring ---------------------------------------------------------

export const fontCss = (size) => `${size}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

let measureCtx = null;
const measureCache = new Map();

/** Width of a text shape in world units. Falls back to an estimate outside a browser. */
function measureTextWidth(text, fontSize) {
  const key = `${fontSize}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  if (!measureCtx && typeof document !== "undefined" && typeof document.createElement === "function") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  let width;
  if (measureCtx) {
    measureCtx.font = fontCss(fontSize);
    width = measureCtx.measureText(text).width;
  } else {
    width = text.length * fontSize * 0.55;
  }
  if (measureCache.size > 500) measureCache.clear();
  measureCache.set(key, width);
  return width;
}

// ---- Geometry ---------------------------------------------------------------

/** Axis-aligned bounding box {x,y,w,h} for any shape; always non-negative w/h. */
export function getBounds(shape) {
  switch (shape.type) {
    case "line":
    case "arrow":
      return {
        x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2),
        w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1),
      };
    case "pen": {
      if (!shape.points.length) return { x: shape.x, y: shape.y, w: 0, h: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "text":
      return { x: shape.x, y: shape.y, w: measureTextWidth(shape.text, shape.fontSize), h: shape.fontSize * 1.25 };
    case "path":
      return pathBounds(shape);
    case "comment":
      return { x: shape.x - 1, y: shape.y - 1, w: 2, h: 2 }; // a pin is a point; its bubble is an overlay
    default:
      return {
        x: Math.min(shape.x, shape.x + shape.w), y: Math.min(shape.y, shape.y + shape.h),
        w: Math.abs(shape.w), h: Math.abs(shape.h),
      };
  }
}

// ---- Rotation & world bounds -------------------------------------------------

const ROTATABLE = new Set(["rect", "ellipse", "image", "text", "polygon", "star"]);
export const isRotatable = (shape) => ROTATABLE.has(shape.type);

export function getCenter(shape) {
  const b = getBounds(shape);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Rotates point `p` about `c` by `deg` degrees. */
export function rotatePoint(p, c, deg) {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Maps a world point into the shape's own unrotated frame. */
export function toLocal(shape, px, py) {
  if (!shape.rotation || !isRotatable(shape)) return { x: px, y: py };
  return rotatePoint({ x: px, y: py }, getCenter(shape), -shape.rotation);
}

/** Axis-aligned bounds in world space, accounting for rotation. */
export function getWorldBounds(shape) {
  const b = getBounds(shape);
  if (!shape.rotation || !isRotatable(shape)) return b;
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
    .map(([x, y]) => rotatePoint({ x, y }, c, shape.rotation));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Smallest box containing every box in `list` (null for an empty list). */
export function unionBounds(list) {
  if (!list.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Everything that should be drawn/exported: hidden shapes, and connectors touching them, are dropped. */
export function visibleShapes(shapes) {
  const hidden = new Set(shapes.filter(s => s.hidden).map(s => s.id));
  return shapes.filter(s => !s.hidden && !(s.type === "connector" && (hidden.has(s.fromId) || hidden.has(s.toId))));
}

// ---- Layer names ---------------------------------------------------------------

const TYPE_LABELS = {
  rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow",
  connector: "Connector", pen: "Drawing", text: "Text", image: "Image", polygon: "Polygon", star: "Star", frame: "Frame", section: "Section", slice: "Slice", comment: "Comment", path: "Vector",
};
export const typeLabel = (type) => TYPE_LABELS[type] || type;

/** "Rectangle 3": numbering per type from `counters` (mutated). */
export function nextName(type, counters) {
  counters[type] = (counters[type] || 0) + 1;
  return `${typeLabel(type)} ${counters[type]}`;
}

/** What the layers panel shows for a shape. */
export function layerLabel(shape) {
  if (shape.type === "comment") {
    const snippet = (shape.text || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `${shape.name || "Comment"}${snippet ? ` · ${snippet}` : ""}`;
  }
  return shape.name || (shape.type === "text" && shape.text ? shape.text : typeLabel(shape.type));
}

/** Bounding box of everything except connectors (which have no box of their own), or null. */
export function getContentBounds(shapes) {
  const boxes = [];
  for (const s of shapes) {
    if (s.type === "connector" || s.hidden) continue;
    const b = getWorldBounds(s);
    const pad = effectsExtent(s.effects, s.strokeWidth || 0); // shadows and blurs extend past the shape
    boxes.push({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
  }
  return unionBounds(boxes);
}

/** Shapes defined by an x/y/w/h box (as opposed to endpoints or points). */
const BOX_TYPES = new Set(["rect", "ellipse", "image", "polygon", "star", "frame", "section", "slice"]);

/** Makes box shapes' w/h positive (they go negative when dragged up/left). */
export function normalizeShape(shape) {
  if (!BOX_TYPES.has(shape.type)) return;
  if (shape.w < 0) { shape.x += shape.w; shape.w = -shape.w; }
  if (shape.h < 0) { shape.y += shape.h; shape.h = -shape.h; }
}

export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Corner points of a polygon/star, in the shape's own (unrotated) frame. A star alternates outer/inner points. */
export function polyVertices(shape) {
  const b = getBounds(shape);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  const n = Math.max(3, Math.round(shape.count || 5));
  const pts = [];
  if (shape.type === "star") {
    const inner = Math.max(0.05, Math.min(0.95, shape.inner ?? 0.5));
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? 1 : inner, a = -Math.PI / 2 + (i * Math.PI) / n;
      pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
  }
  return pts;
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

function tracePolygon(ctx, shape) {
  const pts = polyVertices(shape);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/**
 * True if (px,py) hits the shape. `tol` is in world units (callers divide a
 * screen-pixel tolerance by the zoom so it feels the same at any zoom).
 * Lines and freehand strokes hit only near the stroke, ellipses use the real
 * ellipse equation — not just the bounding box.
 */
export function hitTest(shape, px, py, tol = 4, scale = 1) {
  if (shape.type === "path") return hitTestPath(shape, px, py, tol);
  if (shape.type === "comment") return Math.hypot(px - shape.x, py - (shape.y - 13 / scale)) <= 13 / scale + tol;
  if (shape.rotation && isRotatable(shape)) ({ x: px, y: py } = toLocal(shape, px, py));
  switch (shape.type) {
    case "line":
    case "arrow":
      return distanceToSegment(px, py, shape.x1, shape.y1, shape.x2, shape.y2) <= tol + shape.strokeWidth / 2;
    case "pen": {
      const pts = shape.points, reach = tol + shape.strokeWidth / 2;
      if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y) <= reach;
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reach) return true;
      }
      return false;
    }
    case "polygon":
    case "star": {
      const pts = polyVertices(shape);
      if (pointInPolygon(pts, px, py)) return true;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length];
        if (distanceToSegment(px, py, pts[i].x, pts[i].y, q.x, q.y) <= tol) return true;
      }
      return false;
    }
    case "ellipse": {
      const b = getBounds(shape);
      const rx = b.w / 2 + tol, ry = b.h / 2 + tol;
      const nx = (px - (b.x + b.w / 2)) / rx, ny = (py - (b.y + b.h / 2)) / ry;
      return nx * nx + ny * ny <= 1;
    }
    default: {
      const b = getBounds(shape);
      return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
    }
  }
}

// ---- Selection handles ------------------------------------------------------

const ROTATE_HANDLE_OFFSET_PX = 26;

/** The 8 compass handles of an axis-aligned box. */
export function getBoxHandles(b) {
  const r = b.x + b.w, bt = b.y + b.h, mx = b.x + b.w / 2, my = b.y + b.h / 2;
  return [
    { id: "nw", x: b.x, y: b.y }, { id: "n", x: mx, y: b.y }, { id: "ne", x: r, y: b.y },
    { id: "e", x: r, y: my }, { id: "se", x: r, y: bt }, { id: "s", x: mx, y: bt },
    { id: "sw", x: b.x, y: bt }, { id: "w", x: b.x, y: my },
  ];
}

/**
 * Handles for one shape, in world space (rotated with the shape): 8 for boxes,
 * 1 corner for text, endpoints for lines, none for freehand. Rotatable shapes
 * also get a "rot" handle floating above the top edge at a constant screen distance.
 */
export function getHandles(shape, scale = 1) {
  if (shape.type === "line" || shape.type === "arrow") {
    return [{ id: "p1", x: shape.x1, y: shape.y1 }, { id: "p2", x: shape.x2, y: shape.y2 }];
  }
  if (shape.type === "pen" || shape.type === "comment") return [];
  const b = getBounds(shape);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let handles = shape.type === "text" ? [{ id: "se", x: b.x + b.w, y: b.y + b.h }] : getBoxHandles(b);
  if (isRotatable(shape)) handles.push({ id: "rot", x: c.x, y: b.y - ROTATE_HANDLE_OFFSET_PX / scale });
  if (shape.rotation && isRotatable(shape)) {
    handles = handles.map(h => ({ id: h.id, ...rotatePoint(h, c, shape.rotation) }));
  }
  return handles;
}

const near = (h, px, py, reach) => Math.abs(px - h.x) <= reach && Math.abs(py - h.y) <= reach;

/** Id of the handle under (px,py), or null. Handle size is constant in screen pixels. */
export function hitTestHandle(shape, px, py, scale) {
  const reach = 7 / scale;
  for (const h of getHandles(shape, scale)) if (near(h, px, py, reach)) return h.id;
  return null;
}

/** Same, for the compass handles of a plain box (used for multi-selections). */
export function hitTestBoxHandles(b, px, py, scale) {
  const reach = 7 / scale;
  for (const h of getBoxHandles(b)) if (near(h, px, py, reach)) return h.id;
  return null;
}

function strokeShapeBox(ctx, shape, scale) {
  const b = getBounds(shape);
  ctx.save();
  if (shape.rotation && isRotatable(shape)) {
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  }
  if (shape.type === "pen") ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

function drawHandleMarks(ctx, handles, scale) {
  const size = 8 / scale;
  for (const h of handles) {
    if (h.id === "rot") {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 5 / scale, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else {
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  }
}

/** Selection box + handles for one shape, at constant on-screen size regardless of zoom. */
export function drawSelectionOutline(ctx, shape, scale = 1) {
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1 / scale;
  if (shape.type !== "line" && shape.type !== "arrow") strokeShapeBox(ctx, shape, scale);
  const handles = shape.locked ? [] : getHandles(shape, scale);
  const rot = handles.find(h => h.id === "rot"), top = handles.find(h => h.id === "n");
  if (rot && top) { ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rot.x, rot.y); ctx.stroke(); }
  drawHandleMarks(ctx, handles, scale);
  ctx.restore();
}

/** Thin outline per member plus one box with 8 handles around the whole multi-selection. */
export function drawGroupSelection(ctx, shapes, scale = 1) {
  const nodes = shapes.filter(s => s.type !== "connector");
  if (!nodes.length) return;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1 / scale;
  for (const s of nodes) if (s.type !== "line" && s.type !== "arrow") strokeShapeBox(ctx, s, scale);
  const b = unionBounds(nodes.map(getWorldBounds));
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  drawHandleMarks(ctx, getBoxHandles(b), scale);
  ctx.restore();
}

// ---- Freehand simplification ------------------------------------------------

/** Ramer–Douglas–Peucker (iterative): drops points that don't change the curve by more than `epsilon`. */
export function simplifyPoints(points, epsilon) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0, index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i].x, points[i].y, points[start].x, points[start].y, points[end].x, points[end].y);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (index > -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ---- Drawing ----------------------------------------------------------------

/** Draws one shape, including its effects. `skipEffects` is for cheap draft previews while drawing. */
export function drawShape(ctx, shape, { skipEffects = false } = {}) {
  if (skipEffects || !hasVisibleEffects(shape)) { drawShapeBody(ctx, shape); return; }
  const img = shape.type === "image" ? imageCache.get(shape.src) : null;
  drawWithEffects(ctx, shape, {
    bounds: getWorldBounds(shape),
    drawBody: (c) => drawShapeBody(c, shape, { ignoreOpacity: true }), // opacity is applied when the layer is composited
    drawMask: (c) => drawShapeMask(c, shape),
    cacheable: shape.type !== "image" || !!(img && img.complete && img.naturalWidth > 0), // don't cache before the bitmap decodes
  });
}

/** Applies dash and rotation, the parts of a shape's transform every drawing routine shares. */
function applyShapeTransform(ctx, shape) {
  if (shape.dashed) ctx.setLineDash([shape.strokeWidth * 3, shape.strokeWidth * 2]);
  if (shape.rotation && isRotatable(shape)) {
    const c = getCenter(shape);
    ctx.translate(c.x, c.y);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-c.x, -c.y);
  }
}

/** The shape itself: fill, stroke, text or image — no effects. */
function drawShapeBody(ctx, shape, { ignoreOpacity = false } = {}) {
  ctx.save();
  ctx.globalAlpha = ignoreOpacity ? 1 : (shape.opacity ?? 1); // every shape type
  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth = shape.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  applyShapeTransform(ctx, shape);

  switch (shape.type) {
    case "slice": {
      const { x, y, w, h } = getBounds(shape);
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case "rect":
    case "frame":
    case "section": {
      const { x, y, w, h } = getBounds(shape);
      const radius = Math.min(shape.cornerRadius || 0, w / 2, h / 2);
      const filled = shape.fill || shape.gradient;
      if (filled) ctx.fillStyle = shape.gradient ? buildGradient(ctx, shape.gradient, x, y, w, h) : shape.fill;
      if (radius > 0) {
        traceRoundedRect(ctx, x, y, w, h, radius);
        if (filled) ctx.fill();
        ctx.stroke();
      } else {
        if (filled) ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      break;
    }
    case "ellipse": {
      const { x, y, w, h } = getBounds(shape);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (shape.fill || shape.gradient) {
        ctx.fillStyle = shape.gradient ? buildGradient(ctx, shape.gradient, x, y, w, h) : shape.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "polygon":
    case "star": {
      const { x, y, w, h } = getBounds(shape);
      tracePolygon(ctx, shape);
      if (shape.fill || shape.gradient) {
        ctx.fillStyle = shape.gradient ? buildGradient(ctx, shape.gradient, x, y, w, h) : shape.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "path": {
      const { x, y, w, h } = getBounds(shape);
      tracePath(ctx, shape);
      if (shape.closed && (shape.fill || shape.gradient)) {
        ctx.fillStyle = shape.gradient ? buildGradient(ctx, shape.gradient, x, y, w, h) : shape.fill;
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
      break;
    case "arrow":
      drawArrow(ctx, shape);
      break;
    case "pen":
      drawSmoothPath(ctx, shape.points);
      break;
    case "text":
      ctx.fillStyle = shape.stroke; // text uses the stroke colour as its ink
      ctx.font = fontCss(shape.fontSize);
      ctx.textBaseline = "top";
      ctx.fillText(shape.text, shape.x, shape.y);
      break;
    case "image": {
      const img = imageCache.get(shape.src);
      const { x, y, w, h } = getBounds(shape);
      // Draw only once decoded — preloadShapeImages triggers a re-render when ready.
      if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, x, y, w, h);
      break;
    }
  }
  ctx.restore();
}

/**
 * The shape's *geometry* in solid black, interior included — what background
 * blur, glass, noise and "hide the shadow under the shape" clip to. Different
 * from the body: a translucent or unfilled rectangle still has a solid mask.
 */
function drawShapeMask(ctx, shape) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = shape.strokeWidth;
  if (shape.rotation && isRotatable(shape)) {
    const c = getCenter(shape);
    ctx.translate(c.x, c.y);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-c.x, -c.y);
  }
  const b = getBounds(shape);
  switch (shape.type) {
    case "rect":
    case "frame":
    case "section":
    case "slice": {
      const r = Math.min(shape.cornerRadius || 0, b.w / 2, b.h / 2);
      if (r > 0) { traceRoundedRect(ctx, b.x, b.y, b.w, b.h, r); ctx.fill(); } else ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    }
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "image":
      ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    case "polygon":
    case "star":
      tracePolygon(ctx, shape);
      ctx.fill();
      break;
    case "path":
      tracePath(ctx, shape);
      if (shape.closed) ctx.fill();
      ctx.stroke();
      break;
    case "text":
      ctx.font = fontCss(shape.fontSize);
      ctx.textBaseline = "top";
      ctx.fillText(shape.text, shape.x, shape.y);
      break;
    case "line":
      ctx.beginPath(); ctx.moveTo(shape.x1, shape.y1); ctx.lineTo(shape.x2, shape.y2); ctx.stroke();
      break;
    case "arrow":
      ctx.beginPath(); ctx.moveTo(shape.x1, shape.y1); ctx.lineTo(shape.x2, shape.y2); ctx.stroke();
      break;
    case "pen": {
      if (shape.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Freehand stroke rendered as quadratic curves through segment midpoints — smooth, not jagged. */
function drawSmoothPath(ctx, pts) {
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function drawArrow(ctx, shape) {
  const { x1, y1, x2, y2 } = shape;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const head = 10 + shape.strokeWidth * 2;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

/** Restricts drawing to a frame's (rounded) rectangle — used for the children of clipping frames. */
export function clipToFrame(ctx, frame) {
  const b = getBounds(frame);
  traceRoundedRect(ctx, b.x, b.y, b.w, b.h, Math.min(frame.cornerRadius || 0, b.w / 2, b.h / 2));
  ctx.clip();
}

/** Traces a rounded-rect path, using native ctx.roundRect where available. */
function traceRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Linear gradient across a shape's box at `angle` degrees. */
function buildGradient(ctx, gradient, x, y, w, h) {
  const rad = ((gradient.angle || 0) * Math.PI) / 180;
  const cx = x + w / 2, cy = y + h / 2;
  const dx = Math.cos(rad) * (w / 2), dy = Math.sin(rad) * (h / 2);
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, gradient.from);
  g.addColorStop(1, gradient.to);
  return g;
}
