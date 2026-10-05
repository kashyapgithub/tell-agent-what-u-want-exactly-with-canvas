/**
 * dock.js
 * --------------------------------------------------------------------------
 * Figma's floating bottom toolbar. Each group has a main button (the tool
 * you last used from it) and, for groups with more than one tool, a caret
 * that opens a menu. Also: the Actions button, the Design/Dev mode tabs, and
 * the single-key tool shortcuts.
 *
 * It drives the controller (setTool) and reflects the controller's current
 * tool back (sync), so a shortcut, a menu pick and an Actions command all
 * keep the dock in step.
 * -------------------------------------------------------------------------- */

import { TOOL_GROUPS, ICONS, iconFor, SHORTCUTS } from "./toolRegistry.js";

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v; // static icon markup only
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export function createDock({ rootEl, controller, onAction, onOpenActions, onMode }) {
  const primary = {};      // group id -> the tool its main button currently shows
  const groupEls = {};     // group id -> { root, main, menu }
  let activeTool = "select";

  const toolItems = (group) => group.items.filter(i => i.tool);

  function activate(item) {
    if (item.action) { onAction?.(item.action); return; }
    controller.setTool(item.tool);
  }

  function closeMenus() {
    for (const g of Object.values(groupEls)) g.menu?.classList.add("hidden");
  }

  function build() {
    rootEl.replaceChildren();
    for (const group of TOOL_GROUPS) {
      primary[group.id] = toolItems(group)[0].tool;
      const single = group.items.length === 1;
      const item0 = group.items[0];

      const main = el("button", {
        class: single ? "dock-btn tool-btn" : "dock-btn",
        title: item0.label, html: iconFor(item0),
        "data-group": group.id, ...(single ? { "data-tool": item0.tool } : {}),
        onclick: () => { closeMenus(); controller.setTool(primary[group.id]); },
      });
      const root = el("div", { class: "dock-group", "data-group": group.id }, main);
      let menu = null;

      if (!single) {
        menu = el("div", { class: "dock-menu hidden" }, group.items.map(item => el("button", {
          class: item.tool ? "dock-item tool-btn" : "dock-item",
          ...(item.tool ? { "data-tool": item.tool } : { "data-action": item.action }),
          onclick: (e) => { e.stopPropagation(); closeMenus(); activate(item); },
        }, el("span", { class: "dock-item-icon", html: iconFor(item) }), el("span", { class: "dock-item-label", textContent: item.label }),
          item.key ? el("span", { class: "dock-item-key", textContent: item.key }) : null)));
        const caret = el("button", {
          class: "dock-caret", title: `${group.id} tools`, textContent: "▾",
          onclick: (e) => { e.stopPropagation(); const wasHidden = menu.classList.contains("hidden"); closeMenus(); if (wasHidden) menu.classList.remove("hidden"); },
        });
        root.append(caret, menu);
      }
      groupEls[group.id] = { root, main, menu };
      rootEl.append(root);
    }

    rootEl.append(el("span", { class: "dock-sep" }));
    rootEl.append(el("button", { class: "dock-btn", id: "actions-btn", title: "Actions (Ctrl/Cmd K)", html: ICONS.actions, onclick: () => { closeMenus(); onOpenActions?.(); } }));
    rootEl.append(el("span", { class: "dock-sep" }));
    rootEl.append(el("div", { class: "dock-modes" },
      el("button", { class: "mode-btn active", "data-mode": "design", title: "Design", html: ICONS.design, onclick: () => setMode("design") }),
      el("button", { class: "mode-btn", "data-mode": "dev", title: "Dev mode: inspect CSS and measurements", html: ICONS.dev, onclick: () => setMode("dev") }),
    ));
  }

  function setMode(mode) {
    rootEl.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    onMode?.(mode);
  }

  /** Reflects the controller's current tool: the right group lights up and shows that tool. */
  function sync(tool) {
    activeTool = tool;
    for (const group of TOOL_GROUPS) {
      const item = group.items.find(i => i.tool === tool);
      const g = groupEls[group.id];
      if (item) {
        primary[group.id] = tool;
        g.main.innerHTML = iconFor(item);
        g.main.title = `${item.label}${item.key ? ` (${item.key})` : ""}`;
      }
      g.main.classList.toggle("active", !!item);
    }
    rootEl.querySelectorAll(".tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
  }

  document.addEventListener("click", (e) => { if (!rootEl.contains(e.target)) closeMenus(); });

  /** Single-key tool shortcuts. Ignored while typing and when a modifier means something else. */
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = document.activeElement;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || (target.tagName === "INPUT" && ["text", "number", "search"].includes(target.type)))) return;
    const tool = SHORTCUTS[(e.shiftKey ? "shift+" : "") + e.key.toLowerCase()];
    if (tool) controller.setTool(tool);
  });

  build();
  sync("select");
  return { sync, setMode, closeMenus, getActiveTool: () => activeTool };
}
