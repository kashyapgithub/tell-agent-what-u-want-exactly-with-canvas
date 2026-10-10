/**
 * imageImport.js
 * --------------------------------------------------------------------------
 * Four ways to put a screenshot on the canvas as a reference image:
 *   - drag a file onto the canvas
 *   - Ctrl/Cmd+V with an image on the clipboard (most OS screenshot tools copy
 *     there by default) — works wherever focus is, even in a text box
 *   - "Add screenshot" button → Paste from clipboard (reads the clipboard itself)
 *   - "Add screenshot" button → Upload, or Capture a screen/window/tab
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
    const files = imageFilesFrom(e.clipboardData);
    if (files.length) {
      // An image on the clipboard always wins — even when a text box has focus (e.g. the Folder
      // field), because a screenshot pasted there would otherwise be silently dropped.
      e.preventDefault();
      importFiles(files, viewCentreOrPointer());
      return;
    }
    if (isTextEntry(document.activeElement)) return; // plain text paste — not ours to intercept
    controller.pasteShapes();                         // no image: paste copied shapes
  });

  /** Where a new image lands: under the pointer if it has been over the canvas, else the view centre. */
  function viewCentreOrPointer() {
    const r = canvasEl.getBoundingClientRect();
    const at = lastClient || { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return viewport.toWorld(at.x, at.y);
  }
  const viewCentre = () => {
    const r = canvasEl.getBoundingClientRect();
    return viewport.toWorld(r.left + r.width / 2 - 120, r.top + r.height / 2 - 90);
  };

  /**
   * Button route: reads the clipboard directly (needs the "clipboardRead" permission).
   * Returns "added" | "none" (clipboard has no image) | "denied".
   */
  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith("image/"));
        if (type) files.push(new File([await item.getType(type)], "pasted-image", { type }));
      }
      if (!files.length) return "none";
      await importFiles(files, viewCentre());
      return "added";
    } catch {
      return "denied";
    }
  }

  /** Button route: pick a screen / window / tab and grab one frame of it. Returns "added" | "cancelled" | "unsupported". */
  async function captureScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) return "unsupported";
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
    catch { return "cancelled"; } // user closed the picker
    try {
      const file = await grabFrame(stream);
      await importFiles([file], viewCentre());
      return "added";
    } finally {
      stream.getTracks().forEach(t => t.stop());
    }
  }

  /** "Image…" in the Shape menu: open the file picker and place the chosen images at the centre of the view. */
  function pick() {
    if (!pickerEl) return;
    pickerEl.value = "";
    pickerEl.click();
  }
  if (pickerEl) {
    pickerEl.addEventListener("change", () => importFiles(pickerEl.files, viewCentre()));
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

  return { pick, pasteFromClipboard, captureScreen, importFiles };
}

/** Image files on a clipboard/drag payload, found through `items` or `files` (browsers differ in which they fill). */
export function imageFilesFrom(data) {
  const out = [];
  for (const item of data?.items || []) {
    if (item.kind === "file" && item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) out.push(f); }
  }
  if (!out.length) for (const f of data?.files || []) if (f.type.startsWith("image/")) out.push(f);
  return out;
}

/** Draws one frame of a screen-capture stream onto a canvas and returns it as a PNG File. */
export async function grabFrame(stream) {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // The first frame can be blank while the capture picker is still fading out.
  await new Promise(r => setTimeout(r, 250));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
  return new File([blob], "screen-capture.png", { type: "image/png" });
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