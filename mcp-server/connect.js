/**
 * connect.js
 * --------------------------------------------------------------------------
 * `node connect.js` — finds the coding agents installed on this computer and
 * registers the UI Sketch MCP server with each, so nobody has to copy/paste
 * config. Safe to re-run (idempotent); never overwrites other servers.
 * -------------------------------------------------------------------------- */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgents } from "./lib/agents.js";

const SERVER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");

const results = [];
for (const agent of buildAgents(SERVER_PATH)) {
  if (!agent.detect()) { results.push([agent.name, "not found — skipped"]); continue; }
  let status;
  try { status = agent.register(); } catch (e) { status = `failed (${e.message})`; }
  if (status === "unreadable") status = "config has comments/invalid JSON — left untouched, add it by hand (see README)";
  results.push([agent.name, status]);
}

console.log("\nConnecting UI Sketch to your coding agents:\n");
for (const [name, status] of results) console.log(`  ${name.padEnd(12)} ${status}`);
console.log("\nRestart any agent that was already open, then ask it to \"get the latest sketch\".\n");
