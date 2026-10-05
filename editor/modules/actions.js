/**
 * actions.js
 * --------------------------------------------------------------------------
 * The Actions menu: a searchable command palette (Ctrl/Cmd+K, or the grid
 * button in the dock) that can do nearly anything the editor can — switch
 * tools, edit, arrange, add effects, zoom, toggle panels, export.
 *
 * buildCommands() is the registry (pure data + closures); createActionsPalette()
 * is the UI. Typing filters by every word; ↑/↓ moves; Enter runs; Esc closes.
 * -------------------------------------------------------------------------- */

import { TOOL_GROUPS } from "./toolRegistry.js";
import { EFFECT_TYPES, createEffect } from "./effectsModel.js";

const ALIGNS = [
  ["left", "Align left"], ["hcenter", "Align horizontal centres"], ["right", "Align right"],
  ["top", "Align top"], ["vcenter", "Align vertical centres"], ["bottom", "Align bottom"],
];

/** Every command, as { id, group, label, key?, run }. `ui` supplies the bits only the page knows about. */
export function buildCommands({ controller, engine, ui }) {
  const cmds = [];
  const add = (group, label, run, key = "") => cmds.push({ id: `${group}:${label}`.toLowerCase(), group, label, key, run });

  for (const g of TOOL_GROUPS) {
    for (const item of g.items) {
      if (item.tool) add("Tool", item.label, () => controller.setTool(item.tool), item.key);
      else if (item.action === "image") add("Tool", "Place image…", () => ui.pickImage(), item.key);
    }
  }

  add("Edit", "Undo", () => controller.undoAction(), "⌘Z");
  add("Edit", "Redo", () => controller.redoAction(), "⇧⌘Z");
  add("Edit", "Select all", () => controller.selectAll(), "⌘A");
  add("Edit", "Duplicate", () => controller.duplicateSelected(), "⌘D");
  add("Edit", "Copy", () => controller.copySelected(), "⌘C");
  add("Edit", "Cut", () => controller.cutSelected(), "⌘X");
  add("Edit", "Paste", () => controller.pasteShapes(), "⌘V");
  add("Edit", "Delete", () => controller.deleteSelected(), "⌫");
  add("Edit", "Group selection", () => controller.groupSelected(), "⌘G");
  add("Edit", "Ungroup", () => controller.ungroupSelected(), "⇧⌘G");
  add("Edit", "Frame selection", () => controller.frameSelection(), "⌥⌘G");

  for (const [mode, label] of ALIGNS) add("Arrange", label, () => controller.alignSelected(mode));
  add("Arrange", "Distribute horizontal spacing", () => controller.distributeSelected("x"));
  add("Arrange", "Distribute vertical spacing", () => controller.distributeSelected("y"));
  add("Arrange", "Bring to front", () => controller.reorderSelected("front"), "⇧⌘]");
  add("Arrange", "Bring forward", () => controller.reorderSelected("forward"), "⌘]");
  add("Arrange", "Send backward", () => controller.reorderSelected("backward"), "⌘[");
  add("Arrange", "Send to back", () => controller.reorderSelected("back"), "⇧⌘[");

  add("Layer", "Toggle lock", () => controller.state.selection.forEach(s => controller.toggleLocked(s.id)), "⇧⌘L");
  add("Layer", "Toggle visibility", () => [...controller.state.selection].forEach(s => controller.toggleHidden(s.id)), "⇧⌘H");

  for (const { type, label } of EFFECT_TYPES) {
    add("Effect", `Add ${label.toLowerCase()}`, () => controller.setEffects(list => [...list, createEffect(type)]));
  }
  add("Effect", "Remove all effects", () => controller.setEffects(() => []));

  add("View", "Zoom in", () => engine.zoomBy(1.25), "⌘+");
  add("View", "Zoom out", () => engine.zoomBy(0.8), "⌘−");
  add("View", "Zoom to 100%", () => engine.resetZoom(), "⌘0");
  add("View", "Zoom to fit", () => engine.fit(controller.state.shapes), "⇧1");
  add("View", "Toggle layers panel", () => ui.toggle("layers"));
  add("View", "Toggle effects panel", () => ui.toggle("effects"));
  add("View", "Design mode", () => ui.setMode("design"));
  add("View", "Dev mode (inspect)", () => ui.setMode("dev"));

  add("File", "Send to project", () => ui.exportNow());
  return cmds;
}

/** Matches when every whitespace-separated word of `query` appears in the command's group + label. */
export function filterCommands(commands, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter(c => { const hay = `${c.group} ${c.label}`.toLowerCase(); return words.every(w => hay.includes(w)); });
}

export function createActionsPalette({ modalEl, inputEl, listEl, commands }) {
  let shown = commands, index = 0;

  const row = (cmd, i) => {
    const el = document.createElement("div");
    el.className = `action-row${i === index ? " selected" : ""}`;
    el.setAttribute("role", "option");
    el.dataset.id = cmd.id;
    const group = document.createElement("span"); group.className = "action-group"; group.textContent = cmd.group;
    const label = document.createElement("span"); label.className = "action-label"; label.textContent = cmd.label;
    el.append(group, label);
    if (cmd.key) { const k = document.createElement("span"); k.className = "action-key"; k.textContent = cmd.key; el.append(k); }
    el.addEventListener("click", () => run(cmd));
    el.addEventListener("mousemove", () => { if (index !== i) { index = i; paint(); } });
    return el;
  };

  function paint() {
    listEl.replaceChildren();
    if (!shown.length) {
      const none = document.createElement("div"); none.className = "actions-empty"; none.textContent = "No matching actions";
      listEl.append(none);
      return;
    }
    shown.forEach((cmd, i) => listEl.append(row(cmd, i)));
    listEl.children[index]?.scrollIntoView?.({ block: "nearest" });
  }

  function open() {
    modalEl.classList.remove("hidden");
    inputEl.value = "";
    shown = commands; index = 0;
    paint();
    inputEl.focus();
  }
  function close() { modalEl.classList.add("hidden"); inputEl.blur(); }
  const isOpen = () => !modalEl.classList.contains("hidden");

  function run(cmd) {
    close();
    cmd.run(); // after closing, so the editor has focus again when the action touches it
  }

  inputEl.addEventListener("input", () => { shown = filterCommands(commands, inputEl.value); index = 0; paint(); });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(shown.length - 1, index + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(0, index - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[index]) run(shown[index]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    e.stopPropagation(); // typing here must never trigger editor shortcuts
  });
  modalEl.addEventListener("mousedown", (e) => { if (e.target === modalEl) close(); });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.key === "/")) { e.preventDefault(); isOpen() ? close() : open(); }
  });

  return { open, close, isOpen };
}
