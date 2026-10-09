/**
 * canvasEngine.js
 * --------------------------------------------------------------------------
 * Owns the <canvas>: sizing (DPR-aware), the viewport (zoom + pan), rendering,
 * and the offscreen render used for export.
 *
 * Coordinates: shapes live in *world* space. The viewport maps world -> screen:
 *     screenX = worldX * scale + view.x        (CSS pixels, canvas-relative)
 * Everything that talks to the pointer goes through toWorld()/toScreen(), so
 * no other module needs to know the viewport exists.
 *
 * Rendering is coalesced onto animation frames: a pointer can fire hundreds
 * of events per second, but only one render per display frame is ever done.
 * -------------------------------------------------------------------------- */

import {
  drawShape, drawSelectionOutline, drawGroupSelection, preloadShapeImages, getContentBounds, visibleShapes, getWorldBounds, clipToFrame,
} from "./shapes.js";
import { byIdMap, clippingAncestors } from "./hierarchy.js";
import { drawFrameLabels, drawCommentPins, commentNumbers, drawDraftPath, drawPathEdit } from "./overlays.js";
import { setEffectsCanvasFactory, setFastZoom } from "./effects.js";
import { effectsExtent } from "./effectsModel.js";
import { drawConnector, drawConnectorHighlight, drawDraftConnector } from "./connectors.js";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const MAX_EXPORT_PX = 4096; // longest side of the exported preview PNG

const defaultCreateCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

const ACCENT = "#3a5bd9";
const GUIDE_COLOR = "#f24822";

const overlaps = (a, r) => a.x <= r.x + r.w && a.x + a.w >= r.x && a.y <= r.y + r.h && a.y + a.h >= r.y;

/**
 * Draws connectors first (behind), then every other shape on top. Hidden layers
 * are skipped. With `cull` (the visible world rectangle), shapes entirely
 * off-screen are skipped — mainly so off-screen blurred/shadowed shapes cost nothing.
 */
function drawScene(ctx, allShapes, cull = null) {
  const shapes = visibleShapes(allShapes);
  const byId = byIdMap(shapes);
  for (const s of shapes) if (s.type === "connector") drawConnector(ctx, s, shapes);
  for (const s of shapes) {
    if (s.type === "connector") continue;
    if (cull) {
      const b = getWorldBounds(s), pad = effectsExtent(s.effects, s.strokeWidth || 0);
      if (!overlaps({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, cull)) continue;
    }
    // Children of a clipping frame are only visible inside it.
    const clips = clippingAncestors(s, byId);
    if (clips.length) {
      ctx.save();
      for (const frame of clips) clipToFrame(ctx, frame);
      drawShape(ctx, s);
      ctx.restore();
    } else {
      drawShape(ctx, s);
    }
  }
}

/** Smart-guide lines shown while dragging; constant 1px on screen at any zoom. */
function drawGuides(ctx, guides, scale) {
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / scale;
  for (const g of guides) {
    ctx.beginPath();
    if (g.axis === "x") { ctx.moveTo(g.pos, g.from); ctx.lineTo(g.pos, g.to); }
    else { ctx.moveTo(g.from, g.pos); ctx.lineTo(g.to, g.pos); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarquee(ctx, m, scale) {
  const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1), w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
  ctx.save();
  ctx.fillStyle = "rgba(58, 91, 217, 0.08)";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1 / scale;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export function createCanvasEngine(canvasEl, { createCanvas = defaultCreateCanvas } = {}) {
  const ctx = canvasEl.getContext("2d");
  setEffectsCanvasFactory(createCanvas); // effects render into offscreen canvases made by the same factory
  const view = { scale: 1, x: 0, y: 0 };
  let cssWidth = 0, cssHeight = 0;
  let lastState = null, frameId = 0;
  const viewportListeners = [];
  let panMode = false;

  // ---- sizing -----------------------------------------------------------------

  function resize() {
    const { width, height } = canvasEl.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cssWidth = width; cssHeight = height;
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;
    canvasEl.width = Math.round(width * dpr);   // resetting width clears the canvas...
    canvasEl.height = Math.round(height * dpr);
    if (lastState) scheduleRender(lastState);   // ...so repaint, or resizing the window blanks it
  }

  // ---- viewport ---------------------------------------------------------------

  const notifyViewport = () => viewportListeners.forEach(fn => fn({ scale: view.scale }));

  function toWorld(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
  }

  function toScreen(worldX, worldY) {
    return { x: worldX * view.scale + view.x, y: worldY * view.scale + view.y };
  }

  function panBy(dx, dy) {
    view.x += dx; view.y += dy;
    afterViewChange();
  }

  /** Zooms by `factor`, keeping the world point under (sx, sy) [canvas-relative CSS px] fixed. */
  let zoomTimer = null;
  /** Marks the view as "zooming" so effects render at coarse steps; repaints sharp 160 ms after the last tick. */
  function markZooming() {
    setFastZoom(true);
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => { setFastZoom(false); if (lastState) scheduleRender(lastState); }, 160);
  }

  function zoomAt(sx, sy, factor) {
    markZooming();
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    const k = next / view.scale;
    view.x = sx - (sx - view.x) * k;
    view.y = sy - (sy - view.y) * k;
    view.scale = next;
    afterViewChange();
  }

  const zoomBy = (factor) => zoomAt(cssWidth / 2, cssHeight / 2, factor);

  function resetZoom() {
    zoomAt(cssWidth / 2, cssHeight / 2, 1 / view.scale);
  }

  /** Zooms/pans so all content is visible with margin. */
  function fit(shapes) {
    const b = getContentBounds(shapes);
    if (!b) { view.scale = 1; view.x = 0; view.y = 0; afterViewChange(); return; }
    const margin = 60;
    const scale = Math.max(MIN_SCALE, Math.min(2, (cssWidth - 2 * margin) / b.w, (cssHeight - 2 * margin) / b.h));
    view.scale = scale;
    view.x = (cssWidth - b.w * scale) / 2 - b.x * scale;
    view.y = (cssHeight - b.h * scale) / 2 - b.y * scale;
    afterViewChange();
  }

  function afterViewChange() {
    notifyViewport();
    if (lastState) scheduleRender(lastState);
  }

  // ---- rendering ----------------------------------------------------------------

  /** Requests a render on the next animation frame (many requests -> one render). */
  function scheduleRender(state) {
    lastState = state;
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      renderNow(lastState);
    });
  }

  function renderNow(state) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

    // Any image still decoding triggers a repaint once it's ready.
    preloadShapeImages(state.shapes, () => scheduleRender(state));

    const cull = { x: -view.x / view.scale, y: -view.y / view.scale, w: cssWidth / view.scale, h: cssHeight / view.scale };
    drawScene(ctx, state.shapes, cull);
    if (state.draftShape) drawShape(ctx, state.draftShape, { skipEffects: true }); // keep drawing snappy; effects appear on release
    if (state.draftConnector) drawDraftConnector(ctx, state.draftConnector, state.shapes, view.scale);

    const sel = (state.selection || []).filter(x => x.type !== "comment"); // pins draw their own highlight
    if (state.currentTool === "scale" && sel.some(x => x.type !== "connector")) {
      drawGroupSelection(ctx, sel, view.scale);
    } else if (sel.length === 1) {
      if (sel[0].type === "connector") drawConnectorHighlight(ctx, sel[0], state.shapes, view.scale);
      else drawSelectionOutline(ctx, sel[0], view.scale);
    } else if (sel.length > 1) {
      drawGroupSelection(ctx, sel, view.scale);
      for (const s of sel) if (s.type === "connector") drawConnectorHighlight(ctx, s, state.shapes, view.scale);
    }
    drawFrameLabels(ctx, visibleShapes(state.shapes), state.selectedIds, view.scale);
    const numbers = commentNumbers(state.shapes), picked = new Set(state.selectedIds);
    drawCommentPins(ctx, state.shapes.filter(sh => numbers.has(sh.id))
      .map(sh => ({ x: sh.x, y: sh.y, n: numbers.get(sh.id), resolved: sh.resolved, selected: picked.has(sh.id) })), view.scale);
    if (state.draftPath) drawDraftPath(ctx, state.draftPath, view.scale);
    const editing = state.editPathId && state.shapes.find(sh => sh.id === state.editPathId);
    if (editing) drawPathEdit(ctx, editing, state.editNode, view.scale);
    if (state.guides && state.guides.length) drawGuides(ctx, state.guides, view.scale);
    if (state.marquee) drawMarquee(ctx, state.marquee, view.scale);
  }

  /**
   * Renders the shapes to an offscreen canvas for export: cropped to the
   * content, white background, no selection handles, no draft shapes.
   * Returns { canvas, preview } where `preview` tells a reader how to map
   * image pixels back to world coordinates.
   */
  function renderExport(shapes, { padding = 24, pixelRatio = 2, background = "#ffffff", region = null, notes = [] } = {}) {
    const content = shapes.filter(sh => sh.type !== "slice"); // slices only mark regions; they are not content
    // With a region (an exported frame or slice) the image is exactly that rectangle; otherwise it's cropped to the content.
    const b = region || getContentBounds(content) || { x: 0, y: 0, w: 320, h: 200 };
    const pad = region ? 0 : padding;
    const x0 = b.x - pad, y0 = b.y - pad;
    const w = b.w + pad * 2, h = b.h + pad * 2;
    const ratio = Math.min(pixelRatio, MAX_EXPORT_PX / Math.max(w, h));

    const canvas = createCanvas(Math.max(1, Math.ceil(w * ratio)), Math.max(1, Math.ceil(h * ratio)));
    const c = canvas.getContext("2d");
    c.fillStyle = background;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.setTransform(ratio, 0, 0, ratio, -x0 * ratio, -y0 * ratio);
    drawScene(c, content);
    drawCommentPins(c, notes, ratio); // numbered pins so the image and the JSON `notes` line up

    return { canvas, preview: { origin: { x: x0, y: y0 }, width: w, height: h, pixelRatio: ratio } };
  }

  window.addEventListener("resize", resize);
  // The canvas also changes size when panels open/close, which fires no window resize.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => resize()).observe(canvasEl.parentElement);
  resize();

  return {
    ctx, resize, scheduleRender, renderNow, renderExport,
    toWorld, toScreen, panBy, zoomAt, zoomBy, resetZoom, fit,
    getScale: () => view.scale,
    /** Called whenever the zoom/pan changes (and once immediately). Several listeners may register. */
    addViewportListener(fn) { viewportListeners.push(fn); fn({ scale: view.scale }); },
    setViewportListener(fn) { this.addViewportListener(fn); },
    get panMode() { return panMode; },
    setPanMode(on) { panMode = on; },
  };
}
