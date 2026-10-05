/**
 * imageImport.js
 * --------------------------------------------------------------------------
 * Two ways to put a screenshot on the canvas as a reference image:
 *   - drag a file onto the canvas
 *   - paste from the clipboard (most OS screenshot tools copy there by default)
 *
 * Large screenshots are downscaled on import (see MAX_STORED_DIMENSION): a
 * 2880px retina capture is several megabytes of base64 that would ride along
 * in every export, for no extra legibility to an agent.
 * -------------------------------------------------------------------------- */

import { createShape } from "./shapes.js";

const MAX_DISPLAY_PX = 480;        // initial on-screen size of an imported image
const MAX_STORED_DIMENSION = 1600; // longest side kept in the stored/exported image

export function wireImageImport({ canvasWrapEl, canvasEl, controller, viewport, pickerEl }) {
  let lastClient = null; // last pointer position over the canvas (clipboard paste carries none)

  canvasWrapEl.addEventListener("pointermove", (e) => { lastClient = { x: e.clientX, y: e.clientY }; });

  canvasWrapEl.addEventListener("dragover", (e) => {
    e.preventDefault(); // required for drop to fire
    canvasWrapEl.classList.add("drag-over");
  });
  canvasWrapEl.addEventListener("dragleave", () => canvasWrapEl.classList.remove("drag-over"));
  canvasWrapEl.addEventListener("drop", (e) => {
    e.preventDefault();
    canvasWrapEl.classList.remove("drag-over");
    importFiles(e.dataTransfer?.files, viewport.toWorld(e.clientX, e.clientY));
  });

  document.addEventListener("paste", (e) => {
    if (isTextEntry(document.activeElement)) return; // plain text entry — not ours to intercept
    const files = [...(e.clipboardData?.items || [])]
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) { controller.pasteShapes(); return; } // no image on the clipboard: paste copied shapes
    const r = canvasEl.getBoundingClientRect();
    const at = lastClient || { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    importFiles(files, viewport.toWorld(at.x, at.y));
  });

  /** "Image…" in the Shape menu: open the file picker and place the chosen images at the centre of the view. */
  function pick() {
    if (!pickerEl) return;
    pickerEl.value = "";
    pickerEl.click();
  }
  if (pickerEl) {
    pickerEl.addEventListener("change", () => {
      const r = canvasEl.getBoundingClientRect();
      importFiles(pickerEl.files, viewport.toWorld(r.left + r.width / 2 - 120, r.top + r.height / 2 - 90));
    });
  }

  async function importFiles(fileList, origin) {
    const files = [...(fileList || [])].filter(f => f.type.startsWith("image/"));
    let { x, y } = origin;
    for (const file of files) {
      try {
        const { dataUrl, width, height } = await prepareImage(file);
        // Size relative to the screen so the image is a sensible size at any zoom.
        const worldMax = MAX_DISPLAY_PX / viewport.getScale();
        const k = Math.min(1, worldMax / Math.max(width, height));
        controller.addShape(createShape("image", { x, y, w: width * k, h: height * k, src: dataUrl }));
      } catch (err) {
        console.warn("Could not import image:", err);
      }
      x += 24; y += 24; // stagger multiple images
    }
  }

  return { pick };
}

/** Text fields keep their own paste; sliders/checkboxes (also <input>s) must not block it. */
const isTextEntry = (el) =>
  !!el && (el.isContentEditable || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && ["text", "number", "search"].includes(el.type)));

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

/** Reads a file into a data URL, downscaling it if its longest side exceeds MAX_STORED_DIMENSION. */
async function prepareImage(file) {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const longest = Math.max(img.width, img.height);
  if (longest <= MAX_STORED_DIMENSION) return { dataUrl: original, width: img.width, height: img.height };

  const k = MAX_STORED_DIMENSION / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * k);
  canvas.height = Math.round(img.height * k);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png"; // PNG keeps UI text crisp
  return { dataUrl: canvas.toDataURL(type, 0.92), width: canvas.width, height: canvas.height };
}