/**
 * viewportControls.js
 * --------------------------------------------------------------------------
 * Pan and zoom input, the way design tools do it:
 *   - scroll wheel / two-finger scroll  -> pan
 *   - Ctrl/Cmd + wheel, or trackpad pinch -> zoom around the cursor
 *   - hold Space and drag, or middle-mouse drag -> pan
 *   - Ctrl/Cmd +  /  -  /  0   -> zoom in / out / reset to 100%
 *   - Shift + 1                -> fit all content
 *
 * Pan gestures are handled in the *capture* phase and stop propagation, so
 * the drawing tools never see the pointer events that belong to a pan.
 * -------------------------------------------------------------------------- */

const isTextEntry = (el) =>
  !!el && (el.isContentEditable || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && ["text", "number", "search"].includes(el.type)));

export function wireViewportControls({ canvasEl, engine, getShapes, getTool = () => "select" }) {
  let spaceDown = false;
  let panning = null; // { x, y } last pointer position while panning

  const setCursor = (c) => { canvasEl.style.cursor = c; };

  canvasEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small fractional deltas.
      engine.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
    } else {
      engine.panBy(-e.deltaX, -e.deltaY);
    }
  }, { passive: false });

  canvasEl.addEventListener("pointerdown", (e) => {
    if (!(spaceDown || e.button === 1 || (getTool() === "hand" && e.button === 0))) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // the active tool must not start a drawing gesture
    panning = { x: e.clientX, y: e.clientY };
    canvasEl.setPointerCapture?.(e.pointerId);
    setCursor("grabbing");
  }, true);

  canvasEl.addEventListener("pointermove", (e) => {
    if (!panning) return;
    e.stopImmediatePropagation();
    engine.panBy(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
  }, true);

  window.addEventListener("pointerup", () => {
    if (!panning) return;
    panning = null;
    setCursor(spaceDown || getTool() === "hand" ? "grab" : "");
  });

  window.addEventListener("keydown", (e) => {
    if (isTextEntry(document.activeElement)) return;
    const meta = e.ctrlKey || e.metaKey;

    if (e.code === "Space" && !spaceDown) {
      e.preventDefault(); // otherwise the page scrolls / a focused button activates
      spaceDown = true;
      engine.setPanMode(true);
      setCursor("grab");
      return;
    }
    if (meta && (e.key === "=" || e.key === "+")) { e.preventDefault(); engine.zoomBy(1.25); }
    else if (meta && e.key === "-") { e.preventDefault(); engine.zoomBy(0.8); }
    else if (meta && e.key === "0") { e.preventDefault(); engine.resetZoom(); }
    else if (e.shiftKey && !meta && (e.key === "!" || e.code === "Digit1")) { e.preventDefault(); engine.fit(getShapes()); }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    spaceDown = false;
    engine.setPanMode(false);
    if (!panning) setCursor("");
  });
}
