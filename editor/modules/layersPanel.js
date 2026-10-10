/**
 * layersPanel.js
 * --------------------------------------------------------------------------
 * The layers list, modelled on Figma's:
 *   - frontmost layer on top; frames/sections nest their children, with a
 *     chevron to collapse/expand them (collapsed state is panel-only, not saved)
 *   - click selects; Ctrl/Cmd+click toggles; Shift+click selects the range
 *   - eye = hide, padlock = lock, double-click (or F2) = rename
 *   - drag a row: upper quarter drops ABOVE the target, lower quarter BELOW it,
 *     the middle of a frame/section drops INSIDE it — a line / outline shows which
 *   - right-click: arrange (front/back…), group, rename, lock, hide, delete
 *   - selecting on the canvas expands collapsed parents and scrolls the row into view
 * It only talks to the controller's public actions.
 *
 * update(state) is called on every editor change — including every frame of a
 * drag — so it rebuilds the DOM only when something the panel shows actually
 * changed (compared through a cheap signature string).
 * -------------------------------------------------------------------------- */

import { layerLabel } from "./shapes.js";
import { treeOrder } from "./hierarchy.js";
import { EYE, EYE_OFF, LOCK, UNLOCK, TRASH } from "./icons.js";

const TYPE_ICONS = {
  rect: "▭", ellipse: "◯", line: "╱", arrow: "↗", connector: "⇢", pen: "✎", text: "T", image: "▨", polygon: "⬠", star: "★", frame: "#", section: "▤", slice: "◫", comment: "❝", path: "✒",
};


export function createLayersPanel({ listEl, controller }) {
  let signature = "";
  const collapsed = new Set();      // ids of containers whose children are hidden in the list
  let lastClickedId = null;         // anchor for Shift+click range selection
  let visibleIds = [];              // row order as currently displayed (for range selection)
  let menuEl = null;                // open context menu, if any

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

  const isContainer = (shape) => shape.type === "frame" || shape.type === "section";

  /** Which part of a row the pointer is over decides where a dragged layer lands. */
  function dropWhere(e, row, shape) {
    const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    if (isContainer(shape)) return y < 0.25 ? "above" : y > 0.75 ? "below" : "inside";
    return y < 0.5 ? "above" : "below";
  }
  function showDropHint(row, where) {
    row.dataset.drop = where;
    row.classList.add("drop-target");
  }
  function clearDropHint(row) {
    delete row.dataset.drop;
    row.classList.remove("drop-target");
  }

  /** The expand/collapse arrow (blank spacer for rows without children, so names line up). */
  function chevron(shape, hasKids) {
    const el = document.createElement("span");
    el.className = "layer-chevron";
    if (!hasKids) return el;
    const open = !collapsed.has(shape.id);
    el.textContent = open ? "▾" : "▸";
    el.title = open ? "Collapse" : "Expand";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (open) collapsed.add(shape.id); else collapsed.delete(shape.id);
      signature = ""; update(controller.state);
    });
    return el;
  }

  // ---- context menu ----------------------------------------------------------------

  function closeMenu() { menuEl?.remove(); menuEl = null; }

  function openMenu(x, y, shape) {
    closeMenu();
    const item = (label, hint, run) => ({ label, hint, run });
    const items = [
      item("Bring to front", "⇧⌘]", () => controller.reorderSelected("front")),
      item("Bring forward", "⌘]", () => controller.reorderSelected("forward")),
      item("Send backward", "⌘[", () => controller.reorderSelected("backward")),
      item("Send to back", "⇧⌘[", () => controller.reorderSelected("back")),
      null,
      item("Group selection", "⌘G", () => controller.groupSelected()),
      item("Ungroup", "⇧⌘G", () => controller.ungroupSelected()),
      item("Frame selection", "⌥⌘G", () => controller.frameSelection()),
      null,
      item("Rename", "F2", () => { const n = listEl.querySelector(`[data-id="${shape.id}"] .layer-name`); if (n) startRename(n, shape); }),
      item(shape.locked ? "Unlock" : "Lock", "", () => controller.toggleLocked(shape.id)),
      item(shape.hidden ? "Show" : "Hide", "", () => controller.toggleHidden(shape.id)),
      item("Delete", "⌫", () => controller.deleteSelected()),
    ];
    menuEl = document.createElement("div");
    menuEl.className = "layer-menu";
    for (const it of items) {
      if (!it) { const hr = document.createElement("div"); hr.className = "layer-menu-sep"; menuEl.append(hr); continue; }
      const b = document.createElement("button");
      b.className = "layer-menu-item";
      const l = document.createElement("span"); l.textContent = it.label;
      const h = document.createElement("span"); h.className = "layer-menu-hint"; h.textContent = it.hint;
      b.append(l, h);
      b.addEventListener("click", () => { closeMenu(); it.run(); });
      menuEl.append(b);
    }
    document.body.append(menuEl);
    // Keep it on screen.
    const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    menuEl.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    menuEl.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
    setTimeout(() => {
      document.addEventListener("pointerdown", closeMenu, { once: true });
      document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); }, { once: true });
    }, 0);
  }

  function buildRow(shape, selected, depth = 0, hasKids = false) {
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

    row.append(chevron(shape, hasKids));
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
      // Deletes this layer — or the whole selection when this layer is part of it.
      iconButton(TRASH, "Delete", () => {
        if (!controller.state.selectedIds.includes(shape.id)) controller.select([shape.id], { expand: false });
        controller.deleteSelected();
      }),
    );

    row.addEventListener("click", (e) => {
      if (e.shiftKey && lastClickedId && visibleIds.includes(lastClickedId)) {
        const i = visibleIds.indexOf(lastClickedId), j = visibleIds.indexOf(shape.id);
        controller.select(visibleIds.slice(Math.min(i, j), Math.max(i, j) + 1), { expand: false });
        return;
      }
      lastClickedId = shape.id;
      controller.select([shape.id], { expand: false, toggle: e.ctrlKey || e.metaKey });
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!controller.state.selectedIds.includes(shape.id)) controller.select([shape.id], { expand: false });
      openMenu(e.clientX, e.clientY, shape);
    });

    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", shape.id); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      showDropHint(row, dropWhere(e, row, shape));
    });
    row.addEventListener("dragleave", () => clearDropHint(row));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const where = dropWhere(e, row, shape);
      clearDropHint(row);
      const dragged = e.dataTransfer.getData("text/plain");
      if (dragged && dragged !== shape.id) controller.moveLayer(dragged, shape.id, where);
    });
    return row;
  }

  function update(state) {
    const selected = new Set(state.selectedIds);

    // Selecting something on the canvas must reveal it: expand any collapsed ancestors.
    const byId = new Map(state.shapes.map(x => [x.id, x]));
    let expandedSomething = false;
    for (const id of selected) {
      for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) {
        if (collapsed.delete(p)) expandedSomething = true;
      }
    }

    const sig = state.shapes
      .map(s => `${s.id}|${layerLabel(s)}|${+s.hidden}${+s.locked}|${s.groupId || ""}|${s.parentId || ""}|${+selected.has(s.id)}|${+collapsed.has(s.id)}`)
      .join(";");
    if (sig === signature && !expandedSomething) return;
    signature = sig;

    listEl.replaceChildren();
    visibleIds = [];
    if (!state.shapes.length) {
      const empty = document.createElement("div");
      empty.className = "layers-empty";
      empty.textContent = "Nothing here yet";
      listEl.append(empty);
      return;
    }
    // Frontmost first, like Figma; containers list their contents indented beneath them.
    const hasKids = new Set(state.shapes.filter(s => s.parentId).map(s => s.parentId));
    let hideBelowDepth = Infinity; // while set, skip rows nested under a collapsed container
    for (const { shape, depth } of treeOrder(state.shapes)) {
      if (depth > hideBelowDepth) continue;
      hideBelowDepth = Infinity;
      listEl.append(buildRow(shape, selected.has(shape.id), depth, hasKids.has(shape.id)));
      visibleIds.push(shape.id);
      if (collapsed.has(shape.id)) hideBelowDepth = depth;
    }

    // Keep the first selected row in view (selection made on the canvas).
    const first = [...selected][0];
    if (first) listEl.querySelector(`[data-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // F2 renames the selected layer (Figma's shortcut), as long as the user isn't typing somewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || controller.state.selectedIds.length !== 1) return;
    const id = controller.state.selectedIds[0];
    const shape = controller.state.shapes.find(x => x.id === id);
    const nameEl = listEl.querySelector(`[data-id="${CSS.escape(id)}"] .layer-name`);
    if (shape && nameEl) { e.preventDefault(); startRename(nameEl, shape); }
  });

  return { update, openMenuAt: openMenu };
}
