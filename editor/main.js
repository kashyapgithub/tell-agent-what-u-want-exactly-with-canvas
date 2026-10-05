/**
 * main.js
 * --------------------------------------------------------------------------
 * Entry point. Deliberately thin: constructs the modules and connects them.
 * The engine doubles as the "viewport" the tools use to convert pointer
 * positions into world coordinates.
 * -------------------------------------------------------------------------- */

import { createCanvasEngine } from "./modules/canvasEngine.js";
import { createToolController } from "./modules/tools.js";
import { wireToolbar } from "./modules/toolbar.js";
import { wireImageImport } from "./modules/imageImport.js";
import { wireViewportControls } from "./modules/viewportControls.js";
import { createLayersPanel } from "./modules/layersPanel.js";
import { createEffectsPanel } from "./modules/effectsPanel.js";
import { createDock } from "./modules/dock.js";
import { createComments } from "./modules/comments.js";
import { createInspectPanel } from "./modules/inspect.js";
import { buildCommands, createActionsPalette } from "./modules/actions.js";

/**
 * Design <-> Dev mode. Dev mode is read-only (the controller refuses every edit),
 * hides the editing UI, and shows the Inspect panel with measurements and CSS.
 */
function setMode(mode) {
  document.body.dataset.mode = mode;
  document.getElementById("inspect-panel").classList.toggle("hidden", mode !== "dev");
  if (mode === "dev") document.getElementById("effects-panel").classList.add("hidden");
  window.__uiSketch?.controller.setReadOnly(mode === "dev");
  if (mode === "dev") inspect?.update(window.__uiSketch.controller.state);
}

const canvasEl = document.getElementById("board");
const canvasWrapEl = document.getElementById("canvas-wrap");
const textInputEl = document.getElementById("text-input");

const engine = createCanvasEngine(canvasEl);

let toolbar = null; // assigned below; the controller's first callbacks happen after that
let layers = null;
let effectsPanel = null;
let dock = null;
let imageImport = null;
let palette = null;
let comments = null;
let inspect = null;

const controller = createToolController({
  canvasEl,
  textInputEl,
  viewport: engine,
  onCommentRequest: (pt) => comments?.beginDraft(pt),
  onChange: (state) => {
    engine.scheduleRender(state);
    toolbar?.syncFromSelection(state.selection);
    layers?.update(state);
    effectsPanel?.update(state);
    dock?.sync(state.currentTool);
    comments?.update(state);
    if (document.body.dataset.mode === "dev") inspect?.update(state);
  },
});

toolbar = wireToolbar({ controller, engine });
inspect = createInspectPanel({ panelEl: document.getElementById("inspect-panel"), controller });
comments = createComments({ wrapEl: canvasWrapEl, popEl: document.getElementById("comment-popover"), controller, engine });
layers = createLayersPanel({ listEl: document.getElementById("layers-list"), controller });
effectsPanel = createEffectsPanel({
  panelEl: document.getElementById("effects-panel"),
  buttonEl: document.getElementById("effects-btn"),
  countEl: document.getElementById("effects-count"),
  controller,
});
wireViewportControls({ canvasEl, engine, getShapes: () => controller.state.shapes, getTool: () => controller.state.currentTool });
imageImport = wireImageImport({
  canvasWrapEl, canvasEl, controller, viewport: engine, pickerEl: document.getElementById("image-picker"),
});

dock = createDock({
  rootEl: document.getElementById("dock"),
  controller,
  onAction: (action) => { if (action === "image") imageImport.pick(); },
  onOpenActions: () => palette.open(),
  onMode: (mode) => setMode(mode),
});

engine.scheduleRender(controller.state);
layers.update(controller.state);
toolbar.syncFromSelection(controller.state.selection);

// Debug/test hook: lets automated tests drive the editor. Nothing in the app reads it.
window.__uiSketch = { controller, engine };

// Actions menu (Ctrl/Cmd+K, or the grid button in the dock).
const togglePanel = (id) => document.getElementById(id).classList.toggle("hidden");
palette = createActionsPalette({
  modalEl: document.getElementById("actions-modal"),
  inputEl: document.getElementById("actions-input"),
  listEl: document.getElementById("actions-list"),
  commands: buildCommands({
    controller, engine,
    ui: {
      pickImage: () => imageImport.pick(),
      toggle: (name) => togglePanel(name === "layers" ? "layers" : "effects-panel"),
      setMode: (mode) => dock.setMode(mode),
      exportNow: () => document.getElementById("export-btn").click(),
    },
  }),
});
