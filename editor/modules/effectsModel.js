/**
 * effectsModel.js
 * --------------------------------------------------------------------------
 * The data model for shape effects, modelled on Figma's Effects panel: every
 * shape has an ordered list of effects, each with a type, a visibility toggle
 * and its own parameters. Pure data + helpers — no drawing, no DOM — so the
 * renderer (effects.js) and the panel (effectsPanel.js) share one definition.
 *
 * Effects are treated as IMMUTABLE once attached to a shape: to change one,
 * build a new object and a new array. Undo history snapshots share these
 * objects, so editing one in place would corrupt earlier undo steps.
 * -------------------------------------------------------------------------- */

/** Menu order matches Figma's "+" menu. `beta` is only a label. */
export const EFFECT_TYPES = [
  { type: "inner-shadow", label: "Inner shadow" },
  { type: "drop-shadow", label: "Drop shadow" },
  { type: "layer-blur", label: "Layer blur" },
  { type: "background-blur", label: "Background blur" },
  { type: "noise", label: "Noise" },
  { type: "texture", label: "Texture" },
  { type: "glass", label: "Glass" },
  { type: "shader", label: "Shader", beta: true },
];

export const effectLabel = (type) => EFFECT_TYPES.find(t => t.type === type)?.label ?? type;

/** Effects that read what is already drawn behind the shape (so their result can't be cached). */
export const BACKDROP_TYPES = new Set(["background-blur", "glass"]);

export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light"];
export const NOISE_MODES = ["mono", "duo", "multi"];
export const SHADER_PRESETS = ["mesh", "waves", "plasma"];

const DEFAULTS = {
  "drop-shadow": { x: 0, y: 4, blur: 4, spread: 0, color: "#000000", opacity: 25, showBehind: false },
  "inner-shadow": { x: 0, y: 4, blur: 4, spread: 0, color: "#000000", opacity: 25 },
  "layer-blur": { blur: 4 },
  "background-blur": { blur: 8 },
  noise: { mode: "mono", size: 1, density: 50, color: "#000000", color2: "#ffffff", opacity: 25, blend: "normal" },
  texture: { size: 8, radius: 8, opacity: 50, clip: true },
  glass: { intensity: 80, angle: 135, refraction: 50, depth: 16, dispersion: 0, frost: 8, splay: 0 },
  shader: { preset: "mesh", color1: "#3a5bd9", color2: "#ff5ea8", color3: "#ffd166", scale: 50, seed: 1, opacity: 100, blend: "normal" },
};

let counter = 0;
const effectId = () => `fx${Date.now().toString(36)}${++counter}`;

/** A new effect of `type` with Figma-like default values. */
export function createEffect(type) {
  if (!DEFAULTS[type]) throw new Error(`Unknown effect type: ${type}`);
  return { id: effectId(), type, visible: true, ...DEFAULTS[type] };
}

/** The visible effects of a shape (or of a plain array), in list order. */
export const visibleEffects = (effects) => (effects || []).filter(e => e.visible);

export const hasVisibleEffects = (shape) => visibleEffects(shape.effects).length > 0;

export const hasBackdropEffects = (effects) => visibleEffects(effects).some(e => BACKDROP_TYPES.has(e.type));

/**
 * How far (world units) rendered effects can extend beyond a shape's own
 * bounds — used to size the offscreen layer and to keep exports from clipping
 * shadows. Layer blur spreads *everything* (shadows included), so it adds on top.
 */
export function effectsExtent(effects, strokeWidth = 0) {
  let reach = 0, layerBlur = 0;
  for (const e of visibleEffects(effects)) {
    if (e.type === "drop-shadow") reach = Math.max(reach, e.blur * 1.5 + Math.max(e.spread, 0) + Math.abs(e.x) + Math.abs(e.y));
    else if (e.type === "layer-blur") layerBlur = Math.max(layerBlur, e.blur * 1.5);
    else if (e.type === "glass") reach = Math.max(reach, e.dispersion + 2);
  }
  return Math.ceil(strokeWidth / 2 + 2 + reach + layerBlur);
}

const SCALABLE = {
  "drop-shadow": ["x", "y", "blur", "spread"], "inner-shadow": ["x", "y", "blur", "spread"],
  "layer-blur": ["blur"], "background-blur": ["blur"], noise: ["size"], texture: ["size"], glass: ["depth", "frost"],
};

/** A NEW effects list with every length-like parameter multiplied by `f` (the Scale tool uses this). */
export function scaleEffects(effects, f) {
  return (effects || []).map(e => {
    const next = { ...e };
    for (const k of SCALABLE[e.type] || []) if (typeof next[k] === "number") next[k] = next[k] * f;
    return next;
  });
}
