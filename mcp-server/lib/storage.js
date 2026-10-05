/**
 * lib/storage.js
 * --------------------------------------------------------------------------
 * Both processes in this folder (receiver.js and mcp-tool-server.js) need to
 * agree on exactly one thing: where the latest sketch lives on disk. That's
 * all this module does — it's the shared contract between "the extension
 * pushed a sketch" (receiver.js writes here) and "the agent asked for one"
 * (mcp-tool-server.js reads from here).
 *
 * Storing under the user's home directory (rather than inside whatever
 * project the agent happens to be in) means this works regardless of which
 * repo you're working on at the time.
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const STORE_DIR = path.join(os.homedir(), ".ui-sketch-mcp");
export const JSON_PATH = path.join(STORE_DIR, "latest.json");
export const PNG_PATH = path.join(STORE_DIR, "latest.png");

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

/** Persists a sketch. `pngBase64` is optional (no data: prefix, just the base64 body). */
export function writeSketch({ json, pngBase64 }) {
  ensureStoreDir();
  fs.writeFileSync(JSON_PATH, JSON.stringify(json, null, 2), "utf8");
  if (pngBase64) fs.writeFileSync(PNG_PATH, Buffer.from(pngBase64, "base64"));
}

/** Returns { json, pngBase64 } for the most recent sketch, or null if none exists yet. */
export function readSketch() {
  if (!fs.existsSync(JSON_PATH)) return null;
  const json = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const pngBase64 = fs.existsSync(PNG_PATH) ? fs.readFileSync(PNG_PATH).toString("base64") : null;
  return { json, pngBase64 };
}
