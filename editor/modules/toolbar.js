/**
 * toolbar.js
 * --------------------------------------------------------------------------
 * Wires every toolbar control to the tool controller, viewport and exporter.
 * Returns { syncFromSelection } so the app can reflect the selected shape's
 * real values back into the controls whenever the selection changes.
 * -------------------------------------------------------------------------- */

import { exportSketch } from "./exporter.js";
import { createConnectionDialog } from "./connectionDialog.js";
import { DEFAULT_CONNECTION, loadConnection, testConnection, describeConnection } from "./connection.js";
import { exportScope } from "./exportScope.js";

const FOLDER_STORAGE_KEY = "uiSketchExportFolder";
const MODE_STORAGE_KEY = "uiSketchExportMode";

const $ = (id) => document.getElementById(id);

export function wireToolbar({ controller, engine }) {
  const syncFromSelection = wireStyleControls(controller);
  wireArrangeControls(controller);
  wireHistoryButtons(controller);
  wireZoomControls(engine, controller);
  wireExport(controller, engine);
  return { syncFromSelection };
}

/**
 * Style controls: each patches ONE field — as the default for the next shape
 * and live onto the whole selection — so nudging "Radius" can't overwrite a
 * selected shape's colour. Returns syncFromSelection(selection), which does
 * the reverse: reflects the selected shape's real values into the controls
 * and enables/disables the arrange buttons to match.
 */
function wireStyleControls(controller) {
  const strokeColor = $("stroke-color"), fillColor = $("fill-color"), fillEnabled = $("fill-enabled");
  const strokeWidth = $("stroke-width"), cornerRadius = $("corner-radius"), opacity = $("opacity");
  const gradientEnabled = $("gradient-enabled");
  const gradientToColor = $("gradient-to-color"), gradientToField = $("gradient-to-field");
  const dashedEnabled = $("dashed-enabled"), elbowEnabled = $("elbow-enabled");
  const fontSize = $("font-size"), rotation = $("rotation");
  const shapeCount = $("shape-count"), shapeInner = $("shape-inner");

  let lastKey = null;

  const apply = (partial) => {
    controller.setStyle(partial);
    controller.updateSelectedStyle(partial);
  };
  const currentGradient = () =>
    gradientEnabled.checked ? { from: fillColor.value, to: gradientToColor.value, angle: 90 } : null;
  const clampNumber = (input, lo, hi, fallback) => {
    const n = Number(input.value);
    return Number.isFinite(n) && input.value !== "" ? Math.max(lo, Math.min(hi, n)) : fallback;
  };

  strokeColor.addEventListener("input", () => apply({ stroke: strokeColor.value }));
  strokeWidth.addEventListener("input", () => apply({ strokeWidth: Number(strokeWidth.value) }));
  fillEnabled.addEventListener("input", () => apply({ fill: fillEnabled.checked ? fillColor.value : null }));
  fillColor.addEventListener("input", () => {
    if (fillEnabled.checked) apply({ fill: fillColor.value });
    if (gradientEnabled.checked) apply({ gradient: currentGradient() });
  });
  cornerRadius.addEventListener("input", () => apply({ cornerRadius: Number(cornerRadius.value) }));
  opacity.addEventListener("input", () => apply({ opacity: Number(opacity.value) / 100 }));
  gradientEnabled.addEventListener("input", () => {
    gradientToField.classList.toggle("hidden", !gradientEnabled.checked);
    apply({ gradient: currentGradient() });
  });
  gradientToColor.addEventListener("input", () => {
    if (gradientEnabled.checked) apply({ gradient: currentGradient() });
  });
  dashedEnabled.addEventListener("input", () => apply({ dashed: dashedEnabled.checked }));
  elbowEnabled.addEventListener("input", () => apply({ route: elbowEnabled.checked ? "elbow" : "straight" }));
  fontSize.addEventListener("change", () => apply({ fontSize: clampNumber(fontSize, 8, 400, 18) }));
  shapeCount.addEventListener("change", () => apply({ count: Math.round(clampNumber(shapeCount, 3, 60, 5)) }));
  shapeInner.addEventListener("change", () => apply({ inner: clampNumber(shapeInner, 5, 95, 50) / 100 }));
  rotation.addEventListener("change", () => controller.setSelectedRotation(clampNumber(rotation, -180, 180, 0)));

  // Seed the defaults shown in the HTML.
  apply({
    stroke: strokeColor.value, fill: fillEnabled.checked ? fillColor.value : null,
    strokeWidth: Number(strokeWidth.value), cornerRadius: Number(cornerRadius.value),
    opacity: Number(opacity.value) / 100, gradient: null,
    dashed: false, route: "straight", fontSize: 18, count: 5, inner: 0.5,
  });

  const arrangeButtons = {
    align: document.querySelectorAll("[data-align]"),
    distribute: document.querySelectorAll("[data-distribute]"),
    group: $("group-btn"), ungroup: $("ungroup-btn"),
  };

  /** Reflects the selection into the controls (only when the selection changes). */
  return function syncFromSelection(selection) {
    const nodes = selection.filter(s => s.type !== "connector" && !s.locked);
    const key = selection.map(s => `${s.id}:${s.groupId || ""}:${+s.locked}`).join(",");
    if (key === lastKey) return; // called on every drag frame — must stay cheap
    lastKey = key;

    arrangeButtons.align.forEach(b => { b.disabled = nodes.length < 2; });
    arrangeButtons.distribute.forEach(b => { b.disabled = nodes.length < 3; });
    arrangeButtons.group.disabled = selection.filter(s => s.type !== "connector").length < 2;
    arrangeButtons.ungroup.disabled = !selection.some(s => s.groupId);

    const shape = selection[0];
    if (!shape) return;
    strokeColor.value = shape.stroke;
    strokeWidth.value = shape.strokeWidth;
    opacity.value = Math.round((shape.opacity ?? 1) * 100);
    cornerRadius.value = shape.cornerRadius ?? 0;
    fillEnabled.checked = !!shape.fill;
    if (shape.fill) fillColor.value = shape.fill;
    gradientEnabled.checked = !!shape.gradient;
    if (shape.gradient) { fillColor.value = shape.gradient.from; gradientToColor.value = shape.gradient.to; }
    gradientToField.classList.toggle("hidden", !shape.gradient);
    dashedEnabled.checked = !!shape.dashed;
    elbowEnabled.checked = shape.type === "connector" ? shape.route === "elbow" : elbowEnabled.checked;
    if (shape.type === "text") fontSize.value = shape.fontSize;
    rotation.value = Math.round(shape.rotation || 0);
    if (shape.type === "polygon" || shape.type === "star") { shapeCount.value = shape.count; shapeInner.value = Math.round(shape.inner * 100); }
  };
}

/** Align / distribute / group buttons. Their enabled state is managed by syncFromSelection. */
function wireArrangeControls(controller) {
  document.querySelectorAll("[data-align]").forEach(btn =>
    btn.addEventListener("click", () => controller.alignSelected(btn.dataset.align)));
  document.querySelectorAll("[data-distribute]").forEach(btn =>
    btn.addEventListener("click", () => controller.distributeSelected(btn.dataset.distribute)));
  $("group-btn").addEventListener("click", () => controller.groupSelected());
  $("ungroup-btn").addEventListener("click", () => controller.ungroupSelected());
  $("layers-toggle").addEventListener("click", () => $("layers").classList.toggle("hidden"));
}

function wireHistoryButtons(controller) {
  $("undo-btn").addEventListener("click", () => controller.undoAction());
  $("redo-btn").addEventListener("click", () => controller.redoAction());
  $("clear-btn").addEventListener("click", () => {
    if (confirm("Clear the whole canvas?")) controller.clearAll();
  });
}

function wireZoomControls(engine, controller) {
  const label = $("zoom-label");
  engine.setViewportListener(({ scale }) => { label.textContent = `${Math.round(scale * 100)}%`; });
  $("zoom-in").addEventListener("click", () => engine.zoomBy(1.25));
  $("zoom-out").addEventListener("click", () => engine.zoomBy(0.8));
  label.addEventListener("click", () => engine.resetZoom());
  $("zoom-fit").addEventListener("click", () => engine.fit(controller.state.shapes));
}

function wireExport(controller, engine) {
  const modeSelect = $("export-mode"), folderField = $("folder-field"), folderInput = $("export-folder");
  const connBtn = $("connection-btn"), connDot = $("connection-dot"), connLabel = $("connection-label");
  const exportBtn = $("export-btn"), status = $("export-status");

  let connection = { ...DEFAULT_CONNECTION };

  /** Shows where sketches go, with a dot that turns green/red after a quick background ping. */
  async function refreshConnectionBadge() {
    connLabel.textContent = describeConnection(connection);
    connDot.dataset.state = "busy";
    const r = await testConnection(connection);
    connDot.dataset.state = r.state;
    connDot.title = r.message;
  }

  const dialog = createConnectionDialog({
    onSaved: (c) => { connection = c; refreshConnectionBadge(); },
  });
  connBtn.addEventListener("click", () => dialog.open(connection));

  chrome.storage.local.get([FOLDER_STORAGE_KEY, MODE_STORAGE_KEY], async (result) => {
    if (result[FOLDER_STORAGE_KEY]) folderInput.value = result[FOLDER_STORAGE_KEY];
    if (result[MODE_STORAGE_KEY]) modeSelect.value = result[MODE_STORAGE_KEY];
    connection = await loadConnection();
    applyModeVisibility();
  });

  function applyModeVisibility() {
    const isMcp = modeSelect.value === "mcp";
    folderField.classList.toggle("hidden", isMcp);
    connBtn.classList.toggle("hidden", !isMcp);
    if (isMcp) refreshConnectionBadge();
  }
  modeSelect.addEventListener("change", () => {
    chrome.storage.local.set({ [MODE_STORAGE_KEY]: modeSelect.value });
    applyModeVisibility();
  });

  exportBtn.addEventListener("click", async () => {
    const mode = modeSelect.value;
    const folder = folderInput.value.trim() || "ui-sketches";
    chrome.storage.local.set({ [FOLDER_STORAGE_KEY]: folder });

    status.textContent = "Exporting…";
    status.className = "";
    try {
      // Hidden layers are never exported; a selected frame/section/slice exports just itself.
      const { shapes, region, scope, slices, notes, pins } = exportScope(controller.state.shapes, controller.state.selection);
      const destination = await exportSketch({
        mode, folder, connection, shapes, rendered: engine.renderExport(shapes, { region, notes: pins }), extra: { scope, slices, notes },
      });
      status.textContent = scope ? `Sent ${scope.name} to ${destination}` : `Sent to ${destination}`;
      status.className = "ok";
      if (mode === "mcp") connDot.dataset.state = "ok";
    } catch (err) {
      console.error(err);
      status.textContent = err.message || "Export failed — see console";
      status.className = "err";
      if (mode === "mcp") connDot.dataset.state = "unreachable";
    }
  });
}
