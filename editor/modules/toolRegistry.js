/**
 * toolRegistry.js
 * --------------------------------------------------------------------------
 * The single list of tools and how the dock groups them, copying Figma's
 * bottom toolbar: Move ▾, Frame ▾, Shape ▾, Pen ▾, Text, Comment (plus our
 * Connector for flow diagrams). Every group's main button shows the tool you
 * last used from it; the caret opens the rest.
 *
 * An item is either a real tool (`tool`) or a one-shot action (`action`, e.g.
 * "pick an image file"). Icons are static inline SVG (20x20, stroked).
 * -------------------------------------------------------------------------- */

const svg = (inner) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  select: svg('<path d="M4.5 3.5l11 5-4.6 1.7-1.8 4.6z"/>'),
  hand: svg('<path d="M7 11V5.5a1 1 0 012 0V10V4.5a1 1 0 012 0V10V5.5a1 1 0 012 0v5.5c0 3-1.6 5-4.4 5C6.7 16 5.4 14.7 4.6 12.7L3.7 10.5a1 1 0 011.7-.9L7 11z"/>'),
  scale: svg('<rect x="3" y="8" width="9" height="9" rx="1"/><path d="M12 3.5h4.5V8M16.5 3.5L10.5 9.5"/>'),
  frame: svg('<path d="M6.5 3v14M13.5 3v14M3 6.5h14M3 13.5h14"/>'),
  section: svg('<rect x="3" y="5" width="14" height="11" rx="1.2"/><path d="M3 8.2h5"/>'),
  slice: svg('<path d="M6 2.5V14h11.5M2.5 6H14v11.5"/>'),
  rect: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="1.2"/>'),
  line: svg('<path d="M4 16L16 4"/>'),
  arrow: svg('<path d="M4 16L16 4M8 4h8v8"/>'),
  ellipse: svg('<circle cx="10" cy="10" r="6.5"/>'),
  polygon: svg('<path d="M10 3l6.6 4.8-2.5 7.8H5.9L3.4 7.8z"/>'),
  star: svg('<path d="M10 2.6l2.2 4.8 5.2.6-3.9 3.6 1.1 5.2L10 14l-4.6 2.8 1.1-5.2L2.6 8l5.2-.6z"/>'),
  image: svg('<rect x="3" y="4" width="14" height="12" rx="1.2"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="M3.5 15l4-4 3 3 2-2 3.5 3.5"/>'),
  path: svg('<path d="M10 2.5l5 7.2-5 7.8-5-7.8z"/><circle cx="10" cy="9" r="1.3"/><path d="M10 10.3v7"/>'),
  pen: svg('<path d="M13.5 3.5l3 3L7 16l-4 1 1-4z"/>'),
  text: svg('<path d="M4.5 6V4.5h11V6M10 4.5v11M8 15.5h4"/>'),
  comment: svg('<path d="M4 4.5h12v9H9.2L5.5 16.5v-3H4z"/>'),
  connector: svg('<path d="M4 6h5v8h7M13 11l3 3-3 3"/>'),
  actions: svg('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><path d="M14 11v6M11 14h6"/>'),
  design: svg('<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M3.5 8.5h13M8.5 8.5v8"/>'),
  dev: svg('<path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11 4.5l-2 11"/>'),
};

/** Tool metadata, grouped as the dock shows them. `key` is display text for the shortcut. */
export const TOOL_GROUPS = [
  { id: "move", items: [
    { tool: "select", label: "Move", key: "V" },
    { tool: "hand", label: "Hand tool", key: "H" },
    { tool: "scale", label: "Scale", key: "K" },
  ] },
  { id: "frame", items: [
    { tool: "frame", label: "Frame", key: "F" },
    { tool: "section", label: "Section", key: "⇧S" },
    { tool: "slice", label: "Slice", key: "S" },
  ] },
  { id: "shape", items: [
    { tool: "rect", label: "Rectangle", key: "R" },
    { tool: "line", label: "Line", key: "L" },
    { tool: "arrow", label: "Arrow", key: "⇧L" },
    { tool: "ellipse", label: "Ellipse", key: "O" },
    { tool: "polygon", label: "Polygon" },
    { tool: "star", label: "Star" },
    { action: "image", icon: "image", label: "Image…", key: "⇧⌘K" },
  ] },
  { id: "pen", items: [
    { tool: "path", label: "Pen", key: "P" },
    { tool: "pen", label: "Pencil", key: "⇧P" },
  ] },
  { id: "text", items: [{ tool: "text", label: "Text", key: "T" }] },
  { id: "comment", items: [{ tool: "comment", label: "Comment", key: "C" }] },
  { id: "connector", items: [{ tool: "connector", label: "Connector", key: "X" }] },
];

export const iconFor = (item) => ICONS[item.icon || item.tool];

/** Keyboard shortcut -> tool. Keys are lowercase; Shift variants are prefixed "shift+". */
export const SHORTCUTS = {
  v: "select", h: "hand", k: "scale",
  f: "frame", s: "slice", "shift+s": "section",
  r: "rect", l: "line", "shift+l": "arrow", a: "arrow", o: "ellipse",
  p: "path", "shift+p": "pen",
  t: "text", c: "comment", x: "connector",
};

/** Tools that create new shapes when you click/drag on the canvas (so entering them clears the selection). */
export const CREATION_TOOLS = new Set([
  "frame", "section", "slice", "rect", "line", "arrow", "ellipse", "polygon", "star", "path", "pen", "text", "comment", "connector",
]);

export const toolLabel = (tool) => {
  for (const g of TOOL_GROUPS) for (const it of g.items) if (it.tool === tool) return it.label;
  return tool;
};
