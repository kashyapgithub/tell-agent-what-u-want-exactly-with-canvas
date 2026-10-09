/**
 * lib/agents.js
 * --------------------------------------------------------------------------
 * Knows how to register this MCP server with each supported coding agent.
 * Each agent is a small descriptor: how to detect it, and how to add the
 * server. JSON-config agents share one safe "merge into config" helper;
 * Claude Code is registered through its own CLI.
 *
 * Safety rules for every config write:
 *   - never create config for an agent that isn't installed (detect first);
 *   - never overwrite: parse the existing file, add only our entry;
 *   - back the file up once before the first change;
 *   - if the file can't be parsed (e.g. JSON with comments), leave it alone
 *     and report it, so the user's config is never damaged.
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SERVER_NAME = "ui-sketch";

// ---- JSON config helpers --------------------------------------------------------

/** Reads a JSON file; returns {} if absent, or null if it exists but isn't valid JSON. */
function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

/** Writes JSON, backing the original up (once) as `<file>.ui-sketch.bak`. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}.ui-sketch.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Adds `entry` under `data[key][SERVER_NAME]` in the JSON file.
 * Returns "added" | "updated" | "unchanged" | "unreadable".
 */
export function mergeServerEntry(file, key, entry, extra = {}) {
  const data = readJson(file);
  if (data === null) return "unreadable";
  const section = data[key] && typeof data[key] === "object" ? data[key] : {};
  const before = section[SERVER_NAME];
  if (before && JSON.stringify(before) === JSON.stringify(entry)) return "unchanged";
  section[SERVER_NAME] = entry;
  data[key] = section;
  for (const [k, v] of Object.entries(extra)) if (data[k] === undefined) data[k] = v;
  writeJson(file, data);
  return before ? "updated" : "added";
}

// ---- agent descriptors ------------------------------------------------------------

const home = (...p) => path.join(os.homedir(), ...p);

/** True if `cmd` is runnable from the shell PATH. */
function hasCommand(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * Builds the agent list for a given absolute server path and node binary.
 * `detect()` says whether the agent seems installed; `register()` does the work
 * and returns a status string.
 */
export function buildAgents(serverPath, nodePath = process.execPath) {
  const stdioEntry = { command: nodePath, args: [serverPath] };

  return [
    {
      name: "Claude Code",
      detect: () => hasCommand("claude"),
      register() {
        // --scope user = available in every project, not just the current folder.
        spawnSync("claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"], { stdio: "ignore" });
        const r = spawnSync("claude", ["mcp", "add", "--scope", "user", SERVER_NAME, "--", nodePath, serverPath], { encoding: "utf8" });
        return r.status === 0 ? "added" : `failed (${(r.stderr || r.stdout || "").trim().split("\n")[0]})`;
      },
    },
    {
      name: "Cursor",
      detect: () => fs.existsSync(home(".cursor")),
      register: () => mergeServerEntry(home(".cursor", "mcp.json"), "mcpServers", stdioEntry),
    },
    {
      name: "opencode",
      detect: () => hasCommand("opencode") || fs.existsSync(home(".config", "opencode")),
      // opencode's own shape: `command` is a single array.
      register: () => mergeServerEntry(
        home(".config", "opencode", "opencode.json"),
        "mcp",
        { type: "local", command: [nodePath, serverPath], enabled: true },
        { $schema: "https://opencode.ai/config.json" },
      ),
    },
    {
      name: "Antigravity",
      detect: () => hasCommand("agy") || fs.existsSync(home(".gemini")),
      // Shared by Antigravity 2.0, the IDE and the `agy` CLI. The local command/args
      // form is the common MCP convention but isn't shown in Google's docs.
      register: () => mergeServerEntry(home(".gemini", "config", "mcp_config.json"), "mcpServers", stdioEntry),
    },
  ];
}
