/**
 * effects.js
 * --------------------------------------------------------------------------
 * Renders a shape's effect list. The shape is drawn into an offscreen "layer"
 * (padded so blur and shadows aren't cut off), the effects are composed onto
 * a second layer in Figma's order, and the result is drawn back onto the
 * real canvas:
 *
 *   1. backdrop effects      background blur, glass frost      (see through the shape)
 *   2. drop shadows          behind the shape
 *   3. the shape itself
 *   4. overlay effects       inner shadow, noise, texture, shader, glass rim/light
 *   5. layer blur            blurs everything above
 *
 * Layers are in *device pixels* (world units x the canvas zoom), so effects
 * stay crisp and their sizes track zoom exactly. Results that don't depend on
 * what's behind the shape are cached by a fingerprint that ignores position,
 * so dragging a shape doesn't re-render its effects every frame.
 *
 * shapes.js supplies drawBody / drawMask so this file knows nothing about
 * individual shape types.
 * -------------------------------------------------------------------------- */

import { visibleEffects, effectsExtent, hasBackdropEffects } from "./effectsModel.js";
import { noiseCells, textureOverlay, shaderPixels, hashString } from "./procedural.js";

const MAX_LAYER_PIXELS = 12_000_000;   // beyond this the layer is rendered at lower resolution
const MAX_PROCEDURAL_SIDE = 512;       // texture/shader are generated at most this big, then upscaled
const MAX_NOISE_CELLS = 1024;
const MAX_CACHE_PIXELS = 48_000_000;
const MAX_CACHE_ENTRIES = 80;

let makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
};

/** Lets the engine (and tests) supply how offscreen canvases are created. */
export function setEffectsCanvasFactory(fn) {
  makeCanvas = fn;
  clearEffectsCache();
}

// ---- caches ----------------------------------------------------------------------

const layerCache = new Map(); // fingerprint -> { canvas, pixels }
let cachedPixels = 0;
const procCache = new Map();  // key -> canvas (texture / shader bitmaps)

export function clearEffectsCache() {
  layerCache.clear(); procCache.clear(); cachedPixels = 0;
}

function cacheGet(key) {
  const hit = layerCache.get(key);
  if (!hit) return null;
  layerCache.delete(key); layerCache.set(key, hit); // mark most-recently-used
  return hit.canvas;
}

function cachePut(key, canvas) {
  const pixels = canvas.width * canvas.height;
  layerCache.set(key, { canvas, pixels });
  cachedPixels += pixels;
  while ((cachedPixels > MAX_CACHE_PIXELS || layerCache.size > MAX_CACHE_ENTRIES) && layerCache.size > 1) {
    const [oldKey, old] = layerCache.entries().next().value;
    layerCache.delete(oldKey); cachedPixels -= old.pixels;
  }
}

function procGet(key, build) {
  let c = procCache.get(key);
  if (c) { procCache.delete(key); procCache.set(key, c); return c; }
  c = build();
  procCache.set(key, c);
  if (procCache.size > 24) procCache.delete(procCache.keys().next().value);
  return c;
}

const imageKeys = new Map();
const imageKey = (src) => { if (!imageKeys.has(src)) imageKeys.set(src, imageKeys.size); return imageKeys.get(src); };

/**
 * Identifies everything that affects the rendered layer EXCEPT where the shape
 * is: positions are made relative to its bounds, and opacity (applied when the
 * layer is composited) is left out. Translating a shape keeps the fingerprint.
 */
function fingerprint(shape, b, k, pad) {
  const POSITION = new Set(["x", "y", "x1", "y1", "x2", "y2", "points", "nodes"]);
  const IGNORED = new Set(["id", "name", "hidden", "locked", "groupId", "opacity"]);
  const rel = {};
  for (const key of Object.keys(shape)) if (!POSITION.has(key) && !IGNORED.has(key)) rel[key] = shape[key];

  // Only the position fields a shape type actually uses count, and only relative to its bounds.
  if (shape.type === "line" || shape.type === "arrow") {
    rel.p = [shape.x1 - b.x, shape.y1 - b.y, shape.x2 - b.x, shape.y2 - b.y];
  } else if (shape.type === "pen") {
    rel.p = shape.points.map(pt => [pt.x - b.x, pt.y - b.y]);
  } else if (shape.type === "path") {
    const r = (pt) => pt && [pt.x - b.x, pt.y - b.y];
    rel.p = shape.nodes.map(n => [n.x - b.x, n.y - b.y, r(n.hin), r(n.hout)]);
  } else {
    rel.p = [shape.x - b.x, shape.y - b.y];
  }
  if (shape.src) rel.src = imageKey(shape.src);
  return `${JSON.stringify(rel)}|${k.toFixed(4)}|${pad}`;
}

// ---- small canvas helpers (all in device pixels) -----------------------------------

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

function layer(W, H) {
  const canvas = makeCanvas(W, H);
  return { canvas, ctx: canvas.getContext("2d") };
}

/** A copy of `src` with the same alpha but one solid colour. */
function tint(src, color, W, H) {
  const l = layer(W, H);
  l.ctx.drawImage(src, 0, 0);
  l.ctx.globalCompositeOperation = "source-in";
  l.ctx.fillStyle = color;
  l.ctx.fillRect(0, 0, W, H);
  return l.canvas;
}

/** Gaussian blur, sigma in device pixels. */
function blur(src, sigma, W, H) {
  if (sigma <= 0.05) return src;
  const l = layer(W, H);
  l.ctx.filter = `blur(${sigma}px)`;
  l.ctx.drawImage(src, 0, 0);
  return l.canvas;
}

/** Grows the shape's alpha outward by `r` px by stamping it around a ring (fine for shadow spread). */
function dilate(src, r, W, H) {
  const l = layer(W, H);
  const n = Math.min(48, Math.max(8, Math.ceil(r * 3)));
  l.ctx.drawImage(src, 0, 0);
  for (const radius of [r, r / 2]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      l.ctx.drawImage(src, Math.cos(a) * radius, Math.sin(a) * radius);
    }
  }
  return l.canvas;
}

/** Shrinks the shape's alpha by `r` px: erode = invert(dilate(invert)). */
function erode(src, r, W, H) {
  const inv = layer(W, H);
  inv.ctx.fillStyle = "#000";
  inv.ctx.fillRect(0, 0, W, H);
  inv.ctx.globalCompositeOperation = "destination-out";
  inv.ctx.drawImage(src, 0, 0);
  const grown = dilate(inv.canvas, r, W, H);
  const out = layer(W, H);
  out.ctx.fillStyle = "#000";
  out.ctx.fillRect(0, 0, W, H);
  out.ctx.globalCompositeOperation = "destination-out";
  out.ctx.drawImage(grown, 0, 0);
  return out.canvas;
}

const spreadShape = (src, spreadPx, W, H) =>
  spreadPx > 0.01 ? dilate(src, spreadPx, W, H) : spreadPx < -0.01 ? erode(src, -spreadPx, W, H) : src;

const blendOp = (name) => (!name || name === "normal" ? "source-over" : name);

/** Puts RGBA bytes into a fresh canvas (works in browsers and in Node canvas implementations). */
function bitmap(bytes, w, h) {
  const l = layer(w, h);
  const img = l.ctx.createImageData(w, h);
  img.data.set(bytes);
  l.ctx.putImageData(img, 0, 0);
  return l.canvas;
}

/** Everything a single effect needs, gathered once per layer render. */
function makeContext(mainCtx, shape, bounds, k, ox, oy, pad, W, H, body, mask, out) {
  return {
    mainCtx, shape, bounds, k, ox, oy, W, H, body, mask, out,
    wWorld: bounds.w + 2 * pad, hWorld: bounds.h + 2 * pad,
    cx: (bounds.x + bounds.w / 2 - ox) * k, cy: (bounds.y + bounds.h / 2 - oy) * k,
    transform: mainCtx.getTransform(),
    backdrop: null,
  };
}

/** The part of the main canvas behind this shape, resampled into layer pixels (computed once). */
function getBackdrop(L) {
  if (L.backdrop) return L.backdrop;
  const t = L.transform;
  const l = layer(L.W, L.H);
  l.ctx.drawImage(L.mainCtx.canvas, t.a * L.ox + t.e, t.d * L.oy + t.f, t.a * L.wWorld, t.d * L.hWorld, 0, 0, L.W, L.H);
  L.backdrop = l.canvas;
  return l.canvas;
}

// ---- the effects --------------------------------------------------------------------

function dropShadow(L, fx) {
  const { W, H, k } = L;
  const source = spreadShape(L.body, num(fx.spread) * k, W, H);
  const shadow = blur(tint(source, fx.color, W, H), (num(fx.blur) / 2) * k, W, H);
  const t = layer(W, H);
  t.ctx.globalAlpha = num(fx.opacity, 25) / 100;
  t.ctx.drawImage(shadow, num(fx.x) * k, num(fx.y) * k);
  if (!fx.showBehind) {
    // Default (like Figma): the shadow is hidden under the whole shape, even where its fill is transparent.
    t.ctx.globalAlpha = 1;
    t.ctx.globalCompositeOperation = "destination-out";
    t.ctx.drawImage(L.mask, 0, 0);
  }
  L.out.drawImage(t.canvas, 0, 0);
}

/** Shadow cast inside `clip` (the shape): the inverse of the shape, offset, blurred, clipped back to the shape. */
function innerShadow(L, fx, clip = L.body) {
  const { W, H, k } = L;
  const hole = spreadShape(clip, -num(fx.spread) * k, W, H); // positive spread pushes the shadow inward
  const inv = layer(W, H);
  inv.ctx.fillStyle = fx.color;
  inv.ctx.fillRect(0, 0, W, H);
  inv.ctx.globalCompositeOperation = "destination-out";
  inv.ctx.drawImage(hole, num(fx.x) * k, num(fx.y) * k);
  const shadow = blur(inv.canvas, (num(fx.blur) / 2) * k, W, H);
  const clipped = layer(W, H);
  clipped.ctx.drawImage(shadow, 0, 0);
  clipped.ctx.globalCompositeOperation = "destination-in";
  clipped.ctx.drawImage(clip, 0, 0);
  L.out.globalAlpha = num(fx.opacity, 25) / 100;
  L.out.drawImage(clipped.canvas, 0, 0);
  L.out.globalAlpha = 1;
}

function backgroundBlur(L, fx) {
  const { W, H, k } = L;
  const blurred = blur(getBackdrop(L), (num(fx.blur) / 2) * k, W, H);
  const t = layer(W, H);
  t.ctx.drawImage(blurred, 0, 0);
  t.ctx.globalCompositeOperation = "destination-in";
  t.ctx.drawImage(L.mask, 0, 0); // visible only through the shape's area
  L.out.drawImage(t.canvas, 0, 0);
}

/** Composites a generated bitmap over the shape (clipped to it), with opacity and blend mode. */
function overlay(L, bitmapCanvas, fx, clipToShape = true) {
  const { W, H } = L;
  const t = layer(W, H);
  t.ctx.imageSmoothingEnabled = fx.__pixelated ? false : true;
  t.ctx.drawImage(bitmapCanvas, 0, 0, bitmapCanvas.width, bitmapCanvas.height, 0, 0, fx.__drawW || W, fx.__drawH || H);
  if (clipToShape) {
    t.ctx.globalCompositeOperation = "destination-in";
    t.ctx.drawImage(L.mask, 0, 0);
  }
  L.out.globalAlpha = num(fx.opacity, 100) / 100;
  L.out.globalCompositeOperation = blendOp(fx.blend);
  L.out.drawImage(t.canvas, 0, 0);
  L.out.globalAlpha = 1;
  L.out.globalCompositeOperation = "source-over";
}

function noise(L, fx) {
  const { W, H, k } = L;
  let cell = Math.max(1, num(fx.size, 1) * k);
  cell = Math.max(cell, W / MAX_NOISE_CELLS, H / MAX_NOISE_CELLS); // keep the grid a sane size
  const cols = Math.max(1, Math.ceil(W / cell)), rows = Math.max(1, Math.ceil(H / cell));
  const cells = noiseCells(cols, rows, {
    mode: fx.mode, density: num(fx.density, 50), color: fx.color, color2: fx.color2, seed: hashString(fx.id || "noise"),
  });
  overlay(L, bitmap(cells, cols, rows), { ...fx, __pixelated: true, __drawW: cols * cell, __drawH: rows * cell });
}

/** Resolution at which texture/shader bitmaps are generated, and the factor back to layer pixels. */
function proceduralSize(W, H) {
  const down = Math.min(1, MAX_PROCEDURAL_SIDE / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * down)), h: Math.max(1, Math.round(H * down)), down };
}

function texture(L, fx) {
  const { w, h, down } = proceduralSize(L.W, L.H);
  const size = Math.max(2, num(fx.size, 8) * L.k * down), radius = num(fx.radius, 8);
  const seed = hashString(fx.id || "texture");
  const key = `tex|${w}|${h}|${size.toFixed(2)}|${radius}|${seed}`;
  const bmp = procGet(key, () => bitmap(textureOverlay(w, h, { size, radius, seed }), w, h));
  overlay(L, bmp, fx, fx.clip !== false);
}

function shader(L, fx) {
  const { w, h } = proceduralSize(L.W, L.H);
  const colors = [fx.color1, fx.color2, fx.color3];
  const key = `shd|${w}|${h}|${fx.preset}|${colors.join()}|${fx.scale}|${fx.seed}`;
  const bmp = procGet(key, () => bitmap(shaderPixels(w, h, { preset: fx.preset, colors, scale: num(fx.scale, 50), seed: num(fx.seed, 1) }), w, h));
  overlay(L, bmp, fx);
}

/** Glass, part 1 (behind the shape): frosted, slightly magnified backdrop clipped to the shape. */
function glassBackdrop(L, fx) {
  const { W, H, k } = L;
  let bd = blur(getBackdrop(L), (num(fx.frost, 8) / 2) * k, W, H);
  const zoom = 1 + (num(fx.refraction) / 100) * 0.12; // lens-like magnification
  if (zoom > 1.001) {
    const m = layer(W, H);
    m.ctx.translate(L.cx, L.cy);
    m.ctx.scale(zoom, zoom);
    m.ctx.translate(-L.cx, -L.cy);
    m.ctx.drawImage(bd, 0, 0);
    bd = m.canvas;
  }
  const t = layer(W, H);
  t.ctx.drawImage(bd, 0, 0);
  t.ctx.globalCompositeOperation = "destination-in";
  t.ctx.drawImage(L.mask, 0, 0);
  L.out.drawImage(t.canvas, 0, 0);
}

/** Glass, part 2 (over the shape): a light sheen, a bright rim on the lit side and a soft one opposite, optional colour fringing. */
function glassRim(L, fx) {
  const { W, H, k } = L;
  const intensity = num(fx.intensity, 80);
  const a = (num(fx.angle, 135) * Math.PI) / 180;
  const toLight = { x: Math.cos(a), y: -Math.sin(a) }; // 0deg = light from the right, 90deg = from above
  const depth = Math.max(1, num(fx.depth, 16));
  const rimBlur = depth * (1 + num(fx.splay) / 100);
  const off = depth * 0.4;

  const sheen = tint(L.mask, "#ffffff", W, H);
  L.out.globalAlpha = 0.06 * (intensity / 100);
  L.out.drawImage(sheen, 0, 0);
  L.out.globalAlpha = 1;

  // The bright edge appears on the side the shadow is offset AWAY from, so offset against the light.
  const rim = (color, scale, opacity) => innerShadow(L, {
    x: -toLight.x * off * scale, y: -toLight.y * off * scale, blur: rimBlur, spread: 0, color, opacity,
  }, L.mask);
  const disp = num(fx.dispersion);
  if (disp > 0) {
    rim("#ff4d6d", 1 + disp / 20, intensity * 0.35);
    rim("#4dc3ff", Math.max(0.2, 1 - disp / 40), intensity * 0.35);
  }
  rim("#ffffff", 1, intensity * 0.9);
  rim("#ffffff", -1, intensity * 0.35);
}

// ---- entry point -----------------------------------------------------------------------

function renderLayer(mainCtx, shape, fx, bounds, k, ox, oy, pad, W, H, drawBody, drawMask) {
  const world = (l) => l.ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
  const body = layer(W, H); world(body); drawBody(body.ctx);
  const mask = layer(W, H); world(mask); drawMask(mask.ctx);
  const out = layer(W, H);
  const L = makeContext(mainCtx, shape, bounds, k, ox, oy, pad, W, H, body.canvas, mask.canvas, out.ctx);

  for (const e of fx) { if (e.type === "background-blur") backgroundBlur(L, e); else if (e.type === "glass") glassBackdrop(L, e); }
  for (const e of fx) if (e.type === "drop-shadow") dropShadow(L, e);
  out.ctx.drawImage(body.canvas, 0, 0);
  for (const e of fx) {
    if (e.type === "inner-shadow") innerShadow(L, e);
    else if (e.type === "noise") noise(L, e);
    else if (e.type === "texture") texture(L, e);
    else if (e.type === "shader") shader(L, e);
    else if (e.type === "glass") glassRim(L, e);
  }
  let result = out.canvas;
  for (const e of fx) if (e.type === "layer-blur") result = blur(result, (num(e.blur) / 2) * k, W, H);
  return result;
}

/**
 * Draws `shape` with its effects onto `ctx`.
 *   bounds    world AABB of the shape (rotation included)
 *   drawBody  (ctx) => void   draws the shape opaquely in world coordinates
 *   drawMask  (ctx) => void   draws its geometry (interior included) in solid colour
 *   cacheable false while something the layer depends on (an image) isn't ready yet
 */
export function drawWithEffects(ctx, shape, { bounds, drawBody, drawMask, cacheable = true }) {
  const fx = visibleEffects(shape.effects);
  const t = ctx.getTransform();
  let k = Math.hypot(t.a, t.b) || 1;
  const pad = effectsExtent(fx, shape.strokeWidth);
  const wWorld = bounds.w + 2 * pad, hWorld = bounds.h + 2 * pad;
  if (wWorld * hWorld * k * k > MAX_LAYER_PIXELS) k = Math.sqrt(MAX_LAYER_PIXELS / (wWorld * hWorld));
  const W = Math.max(1, Math.ceil(wWorld * k)), H = Math.max(1, Math.ceil(hWorld * k));
  const ox = bounds.x - pad, oy = bounds.y - pad;

  let out = null, key = null;
  if (cacheable && !hasBackdropEffects(fx)) {
    key = fingerprint(shape, bounds, k, pad);
    out = cacheGet(key);
  }
  if (!out) {
    out = renderLayer(ctx, shape, fx, bounds, k, ox, oy, pad, W, H, drawBody, drawMask);
    if (key) cachePut(key, out);
  }

  ctx.save();
  ctx.globalAlpha *= shape.opacity ?? 1;
  ctx.drawImage(out, ox, oy, W / k, H / k);
  ctx.restore();
}
