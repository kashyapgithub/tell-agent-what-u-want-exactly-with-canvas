/**
 * inspect.js
 * --------------------------------------------------------------------------
 * Dev mode's brain: turns a shape into CSS (so a developer — or an agent — can
 * copy it) and renders the Inspect panel. shapeToCss() is pure.
 *
 * Positions are relative to the containing frame when there is one, like
 * Figma's Dev Mode. Effects map to the closest CSS: drop/inner shadow ->
 * box-shadow (inset), layer blur -> filter, background blur / glass frost ->
 * backdrop-filter. Effects CSS can't express (noise, texture, shader, glass
 * rim light) are listed as comments so nothing is silently dropped.
 * -------------------------------------------------------------------------- */

import { getBounds, layerLabel, polyVertices, typeLabel } from "./shapes.js";
import { visibleEffects, effectLabel } from "./effectsModel.js";
import { hexToRgb } from "./procedural.js";
import { pathToSvg } from "./path.js";

const round = (n) => Math.round(n * 100) / 100;
const px = (n) => `${round(n)}px`;

/** "#rrggbb" + opacity percent -> "rgba(r, g, b, a)". */
export function rgba(hex, opacityPct = 100) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${round(opacityPct / 100)})`;
}

const slug = (s) => (s || "layer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layer";

/** Returns { selector, declarations: [[prop, value]], notes: [string], css } for one shape. */
export function shapeToCss(shape, allShapes = []) {
  const decl = [], notes = [];
  const add = (prop, value) => decl.push([prop, value]);
  const parent = shape.parentId ? allShapes.find(s => s.id === shape.parentId) : null;
  const origin = parent ? getBounds(parent) : { x: 0, y: 0 };
  const b = getBounds(shape);
  const kind = shape.type;

  if (parent) notes.push(`inside "${layerLabel(parent)}" — left/top are relative to it`);
  add("position", "absolute");
  add("left", px(b.x - origin.x));
  add("top", px(b.y - origin.y));
  if (kind !== "text") { add("width", px(b.w)); add("height", px(b.h)); }

  if (kind === "text") {
    add("font-size", px(shape.fontSize));
    add("line-height", "1.25");
    add("font-family", '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif');
    add("color", shape.stroke);
    add("white-space", "nowrap");
    notes.push(`content: "${shape.text}"`);
  } else if (kind === "comment") {
    notes.push(`comment: "${shape.text}"`);
  } else if (kind === "path") {
    notes.push(`SVG path: d="${pathToSvg(shape)}"`);
  } else if (["line", "arrow", "pen"].includes(kind)) {
    notes.push(`${typeLabel(kind)} — best reproduced as an inline SVG (stroke ${shape.stroke}, width ${shape.strokeWidth}px)`);
  } else if (kind === "image") {
    notes.push("image — export the pixels from latest.json / the layer");
  } else {
    if (shape.gradient) add("background", `linear-gradient(${round((shape.gradient.angle || 0) + 90)}deg, ${shape.gradient.from}, ${shape.gradient.to})`);
    else if (shape.fill) add("background", shape.fill);
    if (shape.strokeWidth > 0 && kind !== "slice") {
      add("border", `${px(shape.strokeWidth)} ${shape.dashed ? "dashed" : "solid"} ${shape.stroke}`);
      add("box-sizing", "border-box");
    }
    if (kind === "ellipse") add("border-radius", "50%");
    else if ((kind === "rect" || kind === "frame" || kind === "section") && shape.cornerRadius > 0) add("border-radius", px(shape.cornerRadius));
    if (kind === "polygon" || kind === "star") {
      const pts = polyVertices(shape).map(p => `${round(((p.x - b.x) / (b.w || 1)) * 100)}% ${round(((p.y - b.y) / (b.h || 1)) * 100)}%`);
      add("clip-path", `polygon(${pts.join(", ")})`);
      notes.push("clip-path does not clip the border — draw the outline with SVG if it matters");
    }
    if (kind === "frame" && shape.clip) add("overflow", "hidden");
  }

  if ((shape.opacity ?? 1) < 1) add("opacity", String(round(shape.opacity)));
  if (shape.rotation) add("transform", `rotate(${round(shape.rotation)}deg)`);

  // ---- effects ----
  const shadows = [], blurs = [], backdrop = [];
  for (const e of visibleEffects(shape.effects)) {
    if (e.type === "drop-shadow" || e.type === "inner-shadow") {
      shadows.push(`${e.type === "inner-shadow" ? "inset " : ""}${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${rgba(e.color, e.opacity)}`);
    } else if (e.type === "layer-blur") blurs.push(`blur(${px(e.blur / 2)})`);
    else if (e.type === "background-blur") backdrop.push(`blur(${px(e.blur / 2)})`);
    else if (e.type === "glass") {
      backdrop.push(`blur(${px(e.frost / 2)})`);
      notes.push(`glass: refraction ${e.refraction}%, depth ${e.depth}, dispersion ${e.dispersion}, light ${e.intensity}% at ${e.angle}° — rim lighting has no direct CSS`);
    } else if (e.type === "noise") notes.push(`noise: ${e.mode}, size ${e.size}, density ${e.density}%, opacity ${e.opacity}%, blend ${e.blend}`);
    else if (e.type === "texture") notes.push(`texture: size ${e.size}, radius ${e.radius}, opacity ${e.opacity}%`);
    else if (e.type === "shader") notes.push(`shader (${e.preset}): ${e.color1}, ${e.color2}, ${e.color3}, scale ${e.scale}, opacity ${e.opacity}%`);
  }
  if (shadows.length) add("box-shadow", shadows.join(",\n    "));
  if (blurs.length) add("filter", blurs.join(" "));
  if (backdrop.length) add("backdrop-filter", backdrop.join(" "));

  const selector = `.${slug(layerLabel(shape))}`;
  const body = decl.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const comments = notes.map(n => `  /* ${n} */`).join("\n");
  return { selector, declarations: decl, notes, css: `${selector} {\n${comments ? comments + "\n" : ""}${body}\n}` };
}

/** Human-readable effect summaries for the panel. */
export function describeEffects(shape) {
  return visibleEffects(shape.effects).map(e => {
    if (e.type === "drop-shadow" || e.type === "inner-shadow") return `${effectLabel(e.type)} · X ${e.x} Y ${e.y} · blur ${e.blur} · spread ${e.spread} · ${e.color} ${e.opacity}%`;
    if (e.type === "layer-blur" || e.type === "background-blur") return `${effectLabel(e.type)} · ${e.blur}`;
    return effectLabel(e.type);
  });
}

// ---- the Inspect panel -----------------------------------------------------------------

export function createInspectPanel({ panelEl, controller }) {
  const bodyEl = panelEl.querySelector("#inspect-body");
  let lastSig = "";

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const row = (label, value) => { const r = el("div", "insp-row"); r.append(el("span", "insp-k", label), el("span", "insp-v", value)); return r; };
  const swatch = (label, color) => {
    const r = el("div", "insp-row"); const sw = el("span", "insp-swatch"); sw.style.background = color;
    const v = el("span", "insp-v", color); r.append(el("span", "insp-k", label), sw, v); return r;
  };

  function update(state) {
    const sel = state.selection;
    const sig = sel.map(s => JSON.stringify({ ...s, src: s.src ? s.src.length : 0 })).join("|") + "#" + state.shapes.length;
    if (sig === lastSig) return;
    lastSig = sig;
    bodyEl.replaceChildren();

    if (sel.length !== 1) {
      bodyEl.append(el("div", "insp-empty", sel.length ? `${sel.length} layers selected — select one to inspect it` : "Select a layer to inspect it"));
      return;
    }
    const s = sel[0], b = getBounds(s), parent = s.parentId ? state.shapes.find(x => x.id === s.parentId) : null;
    const origin = parent ? getBounds(parent) : { x: 0, y: 0 };

    bodyEl.append(el("div", "insp-title", layerLabel(s)), el("div", "insp-sub", typeLabel(s.type) + (parent ? ` in ${layerLabel(parent)}` : "")));
    const m = el("div", "insp-section"); m.append(el("div", "insp-h", "Measurements"),
      row("X", px(b.x - origin.x)), row("Y", px(b.y - origin.y)), row("W", px(b.w)), row("H", px(b.h)));
    if (s.rotation) m.append(row("Rotation", `${round(s.rotation)}°`));
    bodyEl.append(m);

    const c = el("div", "insp-section"); c.append(el("div", "insp-h", "Colors"));
    if (s.fill) c.append(swatch("Fill", s.fill));
    if (s.gradient) c.append(swatch("Gradient from", s.gradient.from), swatch("Gradient to", s.gradient.to));
    if (s.strokeWidth > 0 && s.type !== "text") c.append(swatch(`Stroke ${round(s.strokeWidth)}px`, s.stroke));
    if (s.type === "text") c.append(swatch("Text", s.stroke));
    if (c.children.length > 1) bodyEl.append(c);

    const fx = describeEffects(s);
    if (fx.length) { const e = el("div", "insp-section"); e.append(el("div", "insp-h", "Effects")); fx.forEach(t => e.append(el("div", "insp-fx", t))); bodyEl.append(e); }

    const { css } = shapeToCss(s, state.shapes);
    const code = el("div", "insp-section"); const head = el("div", "insp-h", "CSS");
    const copy = el("button", "insp-copy", "Copy"); copy.id = "insp-copy";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(css); copy.textContent = "Copied"; } catch { copy.textContent = "Copy failed"; }
      setTimeout(() => { copy.textContent = "Copy"; }, 1200);
    });
    head.append(copy);
    const pre = el("pre", "insp-code"); pre.id = "insp-css"; pre.textContent = css;
    code.append(head, pre);
    bodyEl.append(code);
  }

  return { update };
}
