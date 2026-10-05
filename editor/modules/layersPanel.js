/**
 * layersPanel.js
 * --------------------------------------------------------------------------
 * The layers list: frontmost shape at the top, click to select (Shift/Ctrl to
 * add), an eye to hide, a padlock to lock, double-click a name to rename, and
 * drag a row to reorder. It only talks to the controller's public actions.
 *
 * update(state) is called on every editor change — including every frame of a
 * drag — so it rebuilds the DOM only when something the panel shows actually
 * changed (compared through a cheap signature string).
 * -------------------------------------------------------------------------- */

import { layerLabel } from "./shapes.js";
import { treeOrder } from "./hierarchy.js";
import { EYE, EYE_OFF, LOCK, UNLOCK } from "./icons.js";

const TYPE_ICONS = {
  rect: "▭", ellipse: "◯", line: "╱", arrow: "↗", connector: "⇢", pen: "✎", text: "T", image: "▨", polygon: "⬠", star: "★", frame: "#", section: "▤", slice: "◫", comment: "❝", path: "✒",
};


export function createLayersPanel({ listEl, controller }) {
  let signature = "";

  function iconButton(svg, title, onClick, active) {
    const btn = document.createElement("button");
    btn.className = `layer-btn${active ? " on" : ""}`;
    btn.title = title;
    btn.innerHTML = svg; // static, trusted markup — never user text
    btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function startRename(nameEl, shape) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "layer-rename";
    input.value = layerLabel(shape);
    // Text inside an <input> within a draggable row can't be selected with the mouse in Chrome,
    // so turn dragging off while renaming (the row is rebuilt afterwards, which turns it back on).
    const row = nameEl.closest(".layer-row");
    if (row) row.draggable = false;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim()) controller.renameShape(shape.id, input.value);
      else signature = ""; // force a rebuild so the label comes back
      update(controller.state);
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
      e.stopPropagation();
    });
  }

  function buildRow(shape, selected, depth = 0) {
    const row = document.createElement("div");
    row.className = `layer-row${selected ? " selected" : ""}${shape.hidden ? " is-hidden" : ""}`;
    row.dataset.id = shape.id;
    row.draggable = true;
    row.style.paddingLeft = `${6 + depth * 14}px`; // children are indented under their frame

    const icon = document.createElement("span");
    icon.className = "layer-icon";
    icon.textContent = TYPE_ICONS[shape.type] || "•";

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layerLabel(shape);
    name.title = "Double-click to rename";
    name.addEventListener("dblclick", (e) => { e.stopPropagation(); startRename(name, shape); });

    row.append(icon);
    if (shape.groupId) {
      const tag = document.createElement("span");
      tag.className = "layer-group";
      tag.textContent = "▣";
      tag.title = "In a group";
      row.append(tag);
    }
    row.append(
      name,
      iconButton(shape.locked ? LOCK : UNLOCK, shape.locked ? "Unlock" : "Lock", () => controller.toggleLocked(shape.id), shape.locked),
      iconButton(shape.hidden ? EYE_OFF : EYE, shape.hidden ? "Show" : "Hide", () => controller.toggleHidden(shape.id), shape.hidden),
    );

    row.addEventListener("click", (e) => {
      controller.select([shape.id], { expand: false, toggle: e.shiftKey || e.ctrlKey || e.metaKey });
    });

    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", shape.id); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drop-target");
      const dragged = e.dataTransfer.getData("text/plain");
      if (dragged && dragged !== shape.id) controller.moveLayer(dragged, shape.id);
    });
    return row;
  }

  function update(state) {
    const selected = new Set(state.selectedIds);
    const sig = state.shapes
      .map(s => `${s.id}|${layerLabel(s)}|${+s.hidden}${+s.locked}|${s.groupId || ""}|${s.parentId || ""}|${+selected.has(s.id)}`)
      .join(";");
    if (sig === signature) return;
    signature = sig;

    listEl.replaceChildren();
    if (!state.shapes.length) {
      const empty = document.createElement("div");
      empty.className = "layers-empty";
      empty.textContent = "Nothing here yet";
      listEl.append(empty);
      return;
    }
    // Frontmost first, like Figma; frames list their contents indented beneath them.
    for (const { shape, depth } of treeOrder(state.shapes)) {
      listEl.append(buildRow(shape, selected.has(shape.id), depth));
    }
  }

  return { update };
}
