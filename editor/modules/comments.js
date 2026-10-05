/**
 * comments.js
 * --------------------------------------------------------------------------
 * The comment box. Two modes:
 *   - drafting:  you clicked with the Comment tool; nothing exists yet. "Post"
 *                (or Ctrl/Cmd+Enter) creates the pin; Esc or an empty note discards.
 *   - editing:   exactly one existing comment is selected; the box edits it.
 *
 * Comments are real shapes (type "comment"), so undo, layers, moving and the
 * clipboard all work on them; the export turns them into numbered pins on the
 * PNG and a `notes` list in the JSON.
 * -------------------------------------------------------------------------- */

import { createShape } from "./shapes.js";
import { commentNumbers } from "./overlays.js";

export function createComments({ wrapEl, popEl, controller, engine }) {
  const q = (id) => popEl.querySelector(id);
  const textEl = q("#cm-text"), titleEl = q("#cm-title"), postBtn = q("#cm-post");
  const resolveBtn = q("#cm-resolve"), deleteBtn = q("#cm-delete"), closeBtn = q("#cm-close");

  let draft = null;     // { x, y } while composing a new comment
  let shownId = null;   // id of the comment being edited
  let anchor = null;    // world point the box is attached to

  function place() {
    if (!anchor) return;
    const p = engine.toScreen(anchor.x, anchor.y);
    const w = wrapEl.getBoundingClientRect().width;
    let left = p.x + 20;
    if (w > 0) left = Math.max(8, Math.min(left, w - 280)); // keep the box inside the canvas area
    popEl.style.left = `${left}px`;
    popEl.style.top = `${Math.max(8, p.y - 50)}px`;
  }

  function show(x, y) { anchor = { x, y }; popEl.classList.remove("hidden"); place(); }
  function hide() { popEl.classList.add("hidden"); shownId = null; anchor = null; }

  function setMode(isDraft, resolved = false) {
    postBtn.classList.toggle("hidden", !isDraft);
    deleteBtn.classList.toggle("hidden", isDraft);
    resolveBtn.classList.toggle("hidden", isDraft);
    resolveBtn.textContent = resolved ? "Reopen" : "Resolve";
  }

  /** Called by the Comment tool: open an empty box at a canvas point. */
  function beginDraft(pt) {
    draft = { x: pt.x, y: pt.y };
    shownId = null;
    titleEl.textContent = "New comment";
    textEl.value = "";
    setMode(true);
    show(pt.x, pt.y);
    setTimeout(() => textEl.focus(), 0);
  }

  function cancel() {
    draft = null;
    hide();
    controller.setTool("select");
  }

  function post() {
    const text = textEl.value.trim();
    if (!draft || !text) { cancel(); return; }
    const at = draft;
    draft = null;
    hide();
    controller.addShape(createShape("comment", { x: at.x, y: at.y, text }));
    controller.setTool("select"); // setTool keeps the new pin selected (Select is not a creation tool)
    controller.select([controller.state.shapes.at(-1).id], { expand: false });
  }

  /** Keeps the box in step with the selection: open for one selected comment, closed otherwise. */
  function update(state) {
    if (draft) return;
    const sel = state.selection;
    const c = sel.length === 1 && sel[0].type === "comment" ? sel[0] : null;
    if (!c) { if (shownId) hide(); return; }
    if (shownId !== c.id) {
      shownId = c.id;
      titleEl.textContent = `Comment ${commentNumbers(state.shapes).get(c.id) ?? ""}`.trim();
      textEl.value = c.text || "";
    }
    setMode(false, !!c.resolved);
    show(c.x, c.y);
  }

  textEl.addEventListener("change", () => {
    if (draft) return;
    const c = controller.state.selection[0];
    if (c && c.type === "comment" && c.text !== textEl.value) controller.updateSelectedStyle({ text: textEl.value });
  });
  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); if (draft) cancel(); else controller.select([]); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (draft) post(); else textEl.blur(); }
    e.stopPropagation(); // typing a note must never trigger editor shortcuts
  });
  postBtn.addEventListener("click", post);
  closeBtn.addEventListener("click", () => { if (draft) cancel(); else controller.select([]); });
  resolveBtn.addEventListener("click", () => {
    const c = controller.state.selection[0];
    if (c && c.type === "comment") controller.updateSelectedStyle({ resolved: !c.resolved });
  });
  deleteBtn.addEventListener("click", () => { controller.deleteSelected(); hide(); });

  engine.addViewportListener(place); // follow the pin as you pan/zoom

  return { beginDraft, update };
}
