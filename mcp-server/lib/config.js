/**
 * lib/config.js
 * --------------------------------------------------------------------------
 * Small persisted settings shared by server.js and lan.js:
 *   lan    true = also accept connections from other computers (e.g. the Mac
 *          that hosts this VM). Default false = this computer only.
 *   token  the "access code" other computers must send. Only enforced for
 *          non-local requests, so local use never needs it.
 * Stored beside the sketches in ~/.ui-sketch-mcp/config.json.
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { STORE_DIR } from "./storage.js";

export const CONFIG_PATH = path.join(STORE_DIR, "config.json");

export function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { lan: !!c.lan, token: typeof c.token === "string" ? c.token : "" };
  } catch {
    return { lan: false, token: "" };
  }
}

export function writeConfig(config) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** A short code people can read off a screen: 8 chars, no look-alikes (0/O, 1/I), shown as ABCD-2345. */
export function newAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Codes are compared ignoring case, dashes and spaces, so typing it loosely still works. */
export const normalizeCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Constant-time comparison of a presented code against the stored one. */
export function codeMatches(presented, stored) {
  const a = Buffer.from(normalizeCode(presented)), b = Buffer.from(normalizeCode(stored));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** This computer's non-loopback IPv4 addresses — what another computer would type to reach it. */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push({ name, address: i.address });
  }
  return out;
}
