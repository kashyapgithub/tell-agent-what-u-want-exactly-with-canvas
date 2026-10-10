/**
 * server.js
 * --------------------------------------------------------------------------
 * One process, two jobs — merged so there's nothing for a person to
 * remember to start by hand:
 *
 *   1. MCP over stdio — exposes `get_latest_sketch` to whichever agent
 *      spawned this process. Cursor, Claude Code, and Antigravity all
 *      launch their configured MCP servers automatically per their own
 *      config (see README) — that happens with zero action from you.
 *
 *   2. A small local HTTP endpoint (`POST /save`) that the Chrome extension
 *      pushes sketches to. Whichever copy of this process grabs the port
 *      first "wins" and becomes the one the extension talks to; every other
 *      copy (e.g. if two agents each spawn their own instance) just skips
 *      that part quietly and still serves MCP tool calls fine, since both
 *      read from the same shared file store (lib/storage.js).
 *
 * For the HTTP side to be available even when no agent is currently open,
 * run `npm run setup` once (see README) — it registers this file to start
 * automatically at login, on macOS/Windows/Linux.
 *
 * IMPORTANT: stdout is reserved for MCP's JSON-RPC framing. Every log line
 * in this file goes to stderr via console.error, never console.log.
 * -------------------------------------------------------------------------- */

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readSketch, writeSketch } from "./lib/storage.js";
import { readConfig, codeMatches } from "./lib/config.js";

const PORT = Number(process.env.PORT) || 5959;
const MAX_BODY_BYTES = 60 * 1024 * 1024; // a big PNG preview, but not unbounded

// Settings are read once at startup; `node lan.js on|off` restarts the service to apply changes.
const config = readConfig();
// Default: this computer only. LAN mode (for a VM / another computer) listens on all interfaces.
const HOST = config.lan ? "0.0.0.0" : "127.0.0.1";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const isLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress);

/** Local requests never need the access code; remote ones always do (and LAN mode is the only way they arrive). */
const needsCode = (req) => config.lan && !isLoopback(req);
const isAuthorized = (req) => !needsCode(req) || codeMatches(req.headers["x-sketch-token"], config.token);

startHttpReceiver();
startMcpServer();

// ---- Job 1: HTTP receiver — accepts pushes from the Chrome extension ------

function startHttpReceiver() {
  const server = http.createServer((req, res) => {
    // CORS is open; access is controlled by the access code (non-local callers) / the bind address.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sketch-Token");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    // /health is open so the extension's "Test connection" can tell "wrong code" from "unreachable".
    if (req.method === "GET" && req.url === "/health") {
      respondJson(res, 200, { ok: true, lan: config.lan, authRequired: needsCode(req), authorized: isAuthorized(req) });
      return;
    }
    if (req.method === "POST" && req.url === "/save") {
      if (!isAuthorized(req)) { respondJson(res, 401, { ok: false, error: "wrong access code" }); return; }
      handleSave(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} already in use — another UI Sketch server instance is already receiving extension pushes. ` +
        `This process will still serve MCP tool calls fine.`
      );
    } else {
      console.error("HTTP receiver error:", err);
    }
  });

  server.listen(PORT, HOST, () => {
    console.error(`UI Sketch receiver listening on http://${HOST}:${PORT}${config.lan ? " (LAN mode, access code required)" : ""}`);
  });
}

function handleSave(req, res) {
  let body = "", size = 0, tooBig = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { tooBig = true; req.destroy(); return; }
    body += chunk;
  });
  req.on("close", () => { if (tooBig && !res.headersSent) respondJson(res, 413, { ok: false, error: "too large" }); });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body);
      writeSketch({ json: payload.json, pngBase64: payload.pngBase64 });
      respondJson(res, 200, { ok: true });
    } catch (err) {
      respondJson(res, 400, { ok: false, error: String(err) });
    }
  });
}

function respondJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ---- Job 2: MCP server — what the coding agent calls ----------------------

function startMcpServer() {
  const server = new McpServer({ name: "ui-sketch-mcp", version: "1.0.0" });

  server.tool(
    "get_latest_sketch",
    "Returns the most recently exported UI sketch from the UI Sketch Chrome " +
      "extension: a JSON description of the shapes drawn (rectangles/ellipses " +
      "as components, text as labels, positions and sizes in CSS pixels) plus " +
      "a PNG preview image. Call this when the user refers to a sketch, " +
      "wireframe, or drawing of a UI they want built.",
    {}, // no input parameters
    async () => {
      const sketch = readSketch();
      if (!sketch) {
        return {
          content: [
            { type: "text", text: "No sketch has been exported yet. Draw one in the UI Sketch extension and click 'Send to project' first." },
          ],
        };
      }
      const content = [{ type: "text", text: JSON.stringify(sketch.json, null, 2) }];
      if (sketch.pngBase64) {
        content.push({ type: "image", data: sketch.pngBase64, mimeType: "image/png" });
      }
      return { content };
    }
  );

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    // Harmless when this instance was started standalone (via `npm run
    // setup`) with no MCP client on the other end of stdio — the HTTP
    // receiver above keeps working regardless.
    console.error("MCP stdio transport not connected:", err.message || err);
  });
}
