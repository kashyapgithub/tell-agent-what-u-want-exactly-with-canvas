/**
 * history.js
 * --------------------------------------------------------------------------
 * Snapshot-based undo/redo. Each snapshot is a *shallow* copy of every shape
 * object. That's safe because nothing mutates a nested value in place after a
 * shape is committed — points arrays, shadow/gradient objects and image src
 * strings are always replaced, never edited — so snapshots can share them.
 *
 * The alternative (JSON deep copy) duplicated every embedded screenshot's
 * multi-megabyte base64 string on every commit and every undo.
 * -------------------------------------------------------------------------- */

const MAX_HISTORY = 100;

const cloneShapes = (shapes) => shapes.map(s => ({ ...s }));

export function createHistory() {
  return { stack: [[]], pointer: 0 };
}

/** Records `shapes` as the new current state, discarding any redo branch. */
export function pushHistory(history, shapes) {
  history.stack = history.stack.slice(0, history.pointer + 1);
  history.stack.push(cloneShapes(shapes));
  if (history.stack.length > MAX_HISTORY) history.stack.shift();
  history.pointer = history.stack.length - 1;
}

/** Steps back and returns a fresh working copy of that state, or null at the start. */
export function undo(history) {
  if (history.pointer <= 0) return null;
  history.pointer -= 1;
  return cloneShapes(history.stack[history.pointer]);
}

/** Steps forward and returns a fresh working copy of that state, or null at the end. */
export function redo(history) {
  if (history.pointer >= history.stack.length - 1) return null;
  history.pointer += 1;
  return cloneShapes(history.stack[history.pointer]);
}
