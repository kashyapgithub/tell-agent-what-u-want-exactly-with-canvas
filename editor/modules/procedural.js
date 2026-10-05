/**
 * procedural.js
 * --------------------------------------------------------------------------
 * Pixel generators for the effects that need per-pixel maths: noise (grain),
 * texture (a lit bump map) and the shader presets. They return raw RGBA byte
 * arrays and know nothing about canvases, so they're testable in plain Node.
 *
 * Everything is driven by a seeded PRNG: the same parameters always give the
 * same pixels, so the live canvas and the exported PNG never disagree and
 * nothing flickers between frames.
 * -------------------------------------------------------------------------- */

/** FNV-1a: a stable 32-bit hash of a string (used to seed effects from their ids). */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "#rrggbb" -> [r, g, b] (black if malformed). */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- Noise ------------------------------------------------------------------

/**
 * A cols x rows grid of grain "cells". `density` (0-100) is the percentage of
 * cells that are filled. mono: one colour; duo: a random mix of two; multi:
 * random colours. The random draws per cell are the same in every mode, so
 * switching mode changes colours without reshuffling where the grain sits.
 */
export function noiseCells(cols, rows, { mode, density, color, color2, seed }) {
  const out = new Uint8ClampedArray(cols * rows * 4);
  const rnd = mulberry32(seed);
  const c1 = hexToRgb(color), c2 = hexToRgb(color2);
  for (let i = 0; i < cols * rows; i++) {
    const on = rnd() * 100 < density;
    const pick = rnd(), r = rnd() * 255, g = rnd() * 255, b = rnd() * 255;
    if (!on) continue;
    const o = i * 4;
    if (mode === "multi") { out[o] = r; out[o + 1] = g; out[o + 2] = b; }
    else {
      const c = mode === "duo" && pick >= 0.5 ? c2 : c1;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    }
    out[o + 3] = 255;
  }
  return out;
}

// ---- Texture ------------------------------------------------------------------

const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth value noise sampler over a random lattice with the given cell size. */
function makeValueNoise(w, h, cell, rnd) {
  const cols = Math.ceil(w / cell) + 3, rows = Math.ceil(h / cell) + 3;
  const lattice = new Float32Array(cols * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = smooth(fx - i), ty = smooth(fy - j);
    const a = lattice[j * cols + i], b = lattice[j * cols + i + 1];
    const c = lattice[(j + 1) * cols + i], d = lattice[(j + 1) * cols + i + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/**
 * A lit bump map as a transparent overlay: white where a bump faces the light
 * (top-left), black where it faces away, clear on flat areas. `size` is the
 * bump size in pixels; `radius` (0-100) softens it — higher = smoother, broader bumps.
 */
export function textureOverlay(w, h, { size, radius, seed }) {
  const rnd = mulberry32(seed);
  const cell = Math.max(2, size);
  const coarse = makeValueNoise(w, h, cell, rnd);
  const fine = makeValueNoise(w, h, Math.max(1.5, cell / 2), rnd);
  const detail = Math.max(0.1, 0.6 - radius / 200);

  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) height[y * w + x] = coarse(x, y) * (1 - detail) + fine(x, y) * detail;
  }

  const out = new Uint8ClampedArray(w * h * 4);
  const gain = (cell / 2) * 1.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const up = height[Math.max(0, y - 1) * w + Math.max(0, x - 1)];
      const down = height[Math.min(h - 1, y + 1) * w + Math.min(w - 1, x + 1)];
      const s = (up - down) * gain; // slope toward the light: +ve = lit, -ve = shaded
      const o = (y * w + x) * 4;
      const v = s > 0 ? 255 : 0;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = clamp01(Math.abs(s)) * 0.9 * 255;
    }
  }
  return out;
}

// ---- Shader presets -----------------------------------------------------------

/** Three-stop colour ramp, t in [0, 1]. */
function ramp(colors, t) {
  const x = clamp01(t) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x)), f = x - i;
  const a = colors[i], b = colors[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Procedural fills. preset: "mesh" (soft blended colour blobs), "waves"
 * (flowing bands) or "plasma" (classic interfering sines). `scale` (1-100)
 * sets the feature size; `seed` reshuffles the layout.
 */
export function shaderPixels(w, h, { preset, colors, scale, seed }) {
  const cols = colors.map(hexToRgb);
  const rnd = mulberry32(seed);
  const out = new Uint8ClampedArray(w * h * 4);
  const big = Math.max(w, h);
  const feature = (0.12 + (scale / 100) * 0.88) * big; // pixels per feature

  const put = (x, y, c) => {
    const o = (y * w + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  };

  if (preset === "mesh") {
    const blobs = Array.from({ length: 5 }, (_, i) => ({ x: rnd() * w, y: rnd() * h, c: cols[i % cols.length] }));
    const two = 2 * feature * feature * 0.35;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, r = 0, g = 0, b = 0;
      for (const p of blobs) {
        const wt = Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / two) + 1e-9;
        sum += wt; r += wt * p.c[0]; g += wt * p.c[1]; b += wt * p.c[2];
      }
      put(x, y, [r / sum, g / sum, b / sum]);
    }
  } else if (preset === "waves") {
    const theta = rnd() * Math.PI, phase = rnd() * 6.28;
    const cos = Math.cos(theta), sin = Math.sin(theta), freq = (2 * Math.PI) / feature;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x * cos + y * sin, v = -x * sin + y * cos;
      put(x, y, ramp(cols, 0.5 + 0.5 * Math.sin(u * freq + 0.6 * Math.sin(v * freq * 0.7 + phase))));
    }
  } else { // plasma
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    const f = (2 * Math.PI) / feature, cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = (Math.sin(x * f + p1) + Math.sin(y * f * 1.3 + p2) + Math.sin((x + y) * f * 0.7 + p3) + Math.sin(Math.hypot(x - cx, y - cy) * f)) / 8 + 0.5;
      put(x, y, ramp(cols, t));
    }
  }
  return out;
}
