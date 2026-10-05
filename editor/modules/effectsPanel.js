/**
 * effectsPanel.js
 * --------------------------------------------------------------------------
 * The Effects popover, modelled on Figma's: a "+" menu of the eight effect
 * types, a list of the shape's effects (click to expand, eye to toggle, "−" to
 * remove) and per-type parameter editors.
 *
 * It edits the first selected shape's list and applies the result to every
 * selected shape; with nothing selected it edits the default for new shapes.
 * Every edit builds a NEW effect object (effects are immutable — see
 * effectsModel.js). While a value is being typed/dragged it updates live
 * without touching undo history; the browser's `change` event commits one undo step.
 * -------------------------------------------------------------------------- */

import { EFFECT_TYPES, createEffect, effectLabel, BLEND_MODES, NOISE_MODES, SHADER_PRESETS } from "./effectsModel.js";
import { EYE, EYE_OFF, MINUS } from "./icons.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v; // only ever static icon markup
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k.startsWith("data-")) el.setAttribute(k, v); // attributes, not JS properties, so dataset works
    else el[k] = v;
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

export function createEffectsPanel({ panelEl, buttonEl, countEl, controller }) {
  const listEl = panelEl.querySelector("#fx-list");
  const menuEl = panelEl.querySelector("#fx-menu");
  const scopeEl = panelEl.querySelector("#fx-scope");
  const open = new Set(); // ids of expanded effects (survives rebuilds)
  let signature = "";
  let lastState = controller.state;

  // ---- editing ------------------------------------------------------------------

  const edit = (id, patch, commit) =>
    controller.setEffects(list => list.map(e => (e.id === id ? { ...e, ...patch } : e)), { commit });
  const remove = (id) => controller.setEffects(list => list.filter(e => e.id !== id));
  const add = (type) => {
    const fx = createEffect(type);
    open.add(fx.id);
    controller.setEffects(list => [...list, fx]);
  };

  // ---- field builders -------------------------------------------------------------

  function numberField(fx, key, { min = -1000, max = 1000, step = 1 } = {}) {
    const input = h("input", { type: "number", value: fx[key], min, max, step });
    input.addEventListener("input", () => {
      if (input.value === "" || !Number.isFinite(+input.value)) return;
      edit(fx.id, { [key]: clamp(+input.value, min, max) }, false);
    });
    input.addEventListener("change", () => {
      if (input.value === "" || !Number.isFinite(+input.value)) input.value = fx[key];
      edit(fx.id, input.value === "" ? {} : { [key]: clamp(+input.value, min, max) }, true);
    });
    return input;
  }

  function colorField(fx, key) {
    const input = h("input", { type: "color", value: fx[key] });
    input.addEventListener("input", () => edit(fx.id, { [key]: input.value }, false));
    input.addEventListener("change", () => edit(fx.id, {}, true));
    return input;
  }

  function selectField(fx, key, options) {
    const select = h("select", {}, options.map(o => h("option", { value: o, textContent: o, selected: fx[key] === o })));
    select.addEventListener("change", () => edit(fx.id, { [key]: select.value }, true));
    return select;
  }

  function checkField(fx, key, label) {
    const input = h("input", { type: "checkbox", checked: !!fx[key] });
    input.addEventListener("change", () => edit(fx.id, { [key]: input.checked }, true));
    return h("label", { class: "fx-check" }, input, label);
  }

  const field = (label, ...controls) => h("div", { class: "fx-field" }, h("span", { textContent: label }), h("div", { class: "fx-inputs" }, controls));
  const opacityField = (fx) => field("Opacity", numberField(fx, "opacity", { min: 0, max: 100 }), "%");

  /** The parameter editor for one effect, by type — the same controls Figma shows. */
  function body(fx) {
    switch (fx.type) {
      case "drop-shadow":
      case "inner-shadow":
        return [
          field("Position", "X", numberField(fx, "x"), "Y", numberField(fx, "y")),
          field("Blur", numberField(fx, "blur", { min: 0, max: 500 })),
          field("Spread", numberField(fx, "spread", { min: -500, max: 500 })),
          field("Color", colorField(fx, "color"), numberField(fx, "opacity", { min: 0, max: 100 }), "%"),
          fx.type === "drop-shadow" ? checkField(fx, "showBehind", "Show behind transparent areas") : null,
        ];
      case "layer-blur":
      case "background-blur":
        return [field("Blur", numberField(fx, "blur", { min: 0, max: 500 }))];
      case "noise":
        return [
          field("Type", selectField(fx, "mode", NOISE_MODES)),
          field("Size", numberField(fx, "size", { min: 1, max: 50, step: 0.5 })),
          field("Density", numberField(fx, "density", { min: 0, max: 100 }), "%"),
          field("Color", colorField(fx, "color"), fx.mode === "duo" ? colorField(fx, "color2") : null),
          opacityField(fx),
          field("Blend", selectField(fx, "blend", BLEND_MODES)),
        ];
      case "texture":
        return [
          field("Size", numberField(fx, "size", { min: 2, max: 200 })),
          field("Radius", numberField(fx, "radius", { min: 0, max: 100 })),
          opacityField(fx),
          checkField(fx, "clip", "Clip to shape"),
        ];
      case "glass":
        return [
          field("Light", numberField(fx, "intensity", { min: 0, max: 100 }), "%", numberField(fx, "angle", { min: -360, max: 360 }), "°"),
          field("Refraction", numberField(fx, "refraction", { min: 0, max: 100 }), "%"),
          field("Depth", numberField(fx, "depth", { min: 1, max: 100 })),
          field("Dispersion", numberField(fx, "dispersion", { min: 0, max: 100 })),
          field("Frost", numberField(fx, "frost", { min: 0, max: 100 })),
          field("Splay", numberField(fx, "splay", { min: 0, max: 100 }), "%"),
        ];
      case "shader":
        return [
          field("Preset", selectField(fx, "preset", SHADER_PRESETS)),
          field("Colors", colorField(fx, "color1"), colorField(fx, "color2"), colorField(fx, "color3")),
          field("Scale", numberField(fx, "scale", { min: 1, max: 100 })),
          field("Seed", numberField(fx, "seed", { min: 0, max: 9999 })),
          opacityField(fx),
          field("Blend", selectField(fx, "blend", BLEND_MODES)),
        ];
      default:
        return [];
    }
  }

  function row(fx) {
    const isOpen = open.has(fx.id);
    const head = h("div", { class: "fx-row-head" },
      h("span", { class: "fx-name", textContent: effectLabel(fx.type) }),
      h("button", { class: "fx-icon fx-eye", title: fx.visible ? "Hide effect" : "Show effect", html: fx.visible ? EYE : EYE_OFF,
        onclick: (e) => { e.stopPropagation(); edit(fx.id, { visible: !fx.visible }, true); } }),
      h("button", { class: "fx-icon fx-remove", title: "Remove effect", html: MINUS,
        onclick: (e) => { e.stopPropagation(); open.delete(fx.id); remove(fx.id); } }),
    );
    head.addEventListener("click", () => {
      if (open.has(fx.id)) open.delete(fx.id); else open.add(fx.id);
      signature = ""; // force a rebuild with the new open/closed state
      update(lastState);
    });
    return h("div", { class: `fx-row${isOpen ? " open" : ""}${fx.visible ? "" : " off"}`, "data-id": fx.id }, head,
      isOpen ? h("div", { class: "fx-body" }, body(fx)) : null);
  }

  // ---- add menu ----------------------------------------------------------------------

  function buildMenu() {
    menuEl.replaceChildren(...EFFECT_TYPES.flatMap(({ type, label, beta }) => {
      const btn = h("button", { "data-type": type, onclick: () => { menuEl.classList.add("hidden"); add(type); } },
        label, beta ? h("span", { class: "beta", textContent: "Beta" }) : null);
      return type === "shader" ? [h("hr"), btn] : [btn];
    }));
  }
  buildMenu();

  panelEl.querySelector("#fx-add").addEventListener("click", (e) => { e.stopPropagation(); menuEl.classList.toggle("hidden"); });
  panelEl.querySelector("#fx-close").addEventListener("click", () => panelEl.classList.add("hidden"));
  panelEl.addEventListener("click", (e) => { if (!menuEl.contains(e.target) && e.target.id !== "fx-add") menuEl.classList.add("hidden"); });
  buttonEl.addEventListener("click", () => panelEl.classList.toggle("hidden"));

  // ---- rendering -------------------------------------------------------------------------

  /** Rebuilds only when something structural changed — never while a value is being typed. */
  function update(state) {
    lastState = state;
    const sel = state.selection || [];
    const effects = sel.length ? (sel[0].effects || []) : state.style.effects;

    countEl.textContent = String(effects.length);
    countEl.classList.toggle("hidden", effects.length === 0);

    const sig = [sel.map(s => s.id).join(), state.undoRevision, effects.map(e => `${e.id}:${e.type}:${+e.visible}`).join(), [...open].join()].join("|");
    if (sig === signature) return;
    signature = sig;

    scopeEl.textContent = sel.length > 1 ? `Applies to ${sel.length} selected shapes` : sel.length === 1 ? "" : "Default for new shapes";
    listEl.replaceChildren(...(effects.length ? effects.map(row) : [h("div", { class: "fx-empty", textContent: "No effects. Press + to add one." })]));
  }

  update(controller.state);
  return { update };
}
