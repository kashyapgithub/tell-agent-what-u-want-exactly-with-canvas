/**
 * screenshotMenu.js
 * --------------------------------------------------------------------------
 * The "Add screenshot" button at the top of the toolbar:
 *
 *   Paste from clipboard   reads the clipboard now (same as Ctrl/Cmd+V)
 *   Upload image…          file picker
 *   Capture screen/window… browser's screen-share picker, grabs one frame
 *
 * Shortcut Ctrl/Cmd+Shift+K: paste from the clipboard if it holds an image,
 * otherwise open the file picker — the one-keystroke path.
 * -------------------------------------------------------------------------- */

const MESSAGES = {
  none: "No image on the clipboard — copy a screenshot first.",
  denied: "Chrome blocked clipboard access — press Ctrl/Cmd+V instead.",
  cancelled: "Capture cancelled.",
  unsupported: "Screen capture isn't available here.",
};

export function wireScreenshotMenu({ buttonEl, menuEl, statusEl, imageImport }) {
  let statusTimer = null;
  const say = (text) => {
    statusEl.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 4000);
  };
  const open = () => menuEl.classList.remove("hidden");
  const close = () => menuEl.classList.add("hidden");

  /** Runs one of the three actions and reports the outcome in the little status text. */
  async function run(action) {
    close();
    if (action === "upload") { imageImport.pick(); return; }
    const result = action === "paste" ? await imageImport.pasteFromClipboard() : await imageImport.captureScreen();
    if (result !== "added") say(MESSAGES[result] || "");
  }

  buttonEl.addEventListener("click", (e) => { e.stopPropagation(); menuEl.classList.contains("hidden") ? open() : close(); });
  menuEl.addEventListener("click", (e) => {
    const item = e.target.closest("[data-shot]");
    if (item) run(item.dataset.shot);
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      imageImport.pasteFromClipboard().then((r) => { if (r !== "added") imageImport.pick(); });
    }
  });

  return { run };
}
