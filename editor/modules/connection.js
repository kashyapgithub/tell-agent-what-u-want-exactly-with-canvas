/**
 * connection.js
 * --------------------------------------------------------------------------
 * Where the extension sends sketches in "MCP server" mode, and how to check
 * that it works. No DOM here — the dialog (connectionDialog.js) is just a
 * form over these functions, and everything is injectable so it can be
 * tested without Chrome.
 *
 * A connection is { where: "local" | "remote", host, port, token }:
 *   local   the agent runs on this computer  -> http://127.0.0.1:<port>
 *   remote  the agent runs in a VM / another computer -> http://<host>:<port>,
 *           with the access code the server shows on that machine.
 * -------------------------------------------------------------------------- */

export const CONNECTION_STORAGE_KEY = "connection";
export const DEFAULT_PORT = 5959;
const HEADER = "X-Sketch-Token";

export const DEFAULT_CONNECTION = Object.freeze({ where: "local", host: "", port: DEFAULT_PORT, token: "" });

/**
 * Accepts what people actually type or paste ("http://192.168.1.5:5959/", " ubuntu.local ")
 * and returns a bare host name / IPv4 address, or "" if it can't be one.
 */
export function cleanHost(input) {
  let h = String(input || "").trim();
  h = h.replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h) ? h : "";
}

/** Fills defaults and fixes up odd values (bad port, stray spaces, unknown mode). */
export function normalizeConnection(raw = {}) {
  const port = Number(raw.port);
  return {
    where: raw.where === "remote" ? "remote" : "local",
    host: cleanHost(raw.host),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    token: String(raw.token || "").trim(),
  };
}

/** A short human label for the toolbar: "this computer" or "192.168.1.5". */
export const describeConnection = (c) => (c.where === "remote" && c.host ? c.host : "this computer");

/** Base URL for the receiver, or null if a remote connection has no usable address yet. */
export function receiverBase(c) {
  if (c.where === "remote") return c.host ? `http://${c.host}:${c.port}` : null;
  return `http://127.0.0.1:${c.port}`;
}

/** Headers for a request to the receiver (adds the access code only for remote). */
export function requestHeaders(c, extra = {}) {
  const h = { ...extra };
  if (c.where === "remote" && c.token) h[HEADER] = c.token;
  return h;
}

// ---- storage -----------------------------------------------------------------------

/** Loads the saved connection; falls back to the old single "port" setting so earlier installs keep working. */
export function loadConnection(storage = chrome.storage.local) {
  return new Promise((resolve) => {
    storage.get([CONNECTION_STORAGE_KEY, "uiSketchMcpPort"], (r) => {
      const saved = r?.[CONNECTION_STORAGE_KEY];
      resolve(normalizeConnection(saved || { where: "local", port: r?.uiSketchMcpPort }));
    });
  });
}

export function saveConnection(conn, storage = chrome.storage.local) {
  return new Promise((resolve) => storage.set({ [CONNECTION_STORAGE_KEY]: normalizeConnection(conn) }, resolve));
}

// ---- permissions -------------------------------------------------------------------

/**
 * Chrome only lets an extension talk to arbitrary addresses once the user has
 * allowed that address. `request` must run inside a click handler. Local
 * connections are already covered by the manifest, so they return true.
 */
export async function ensureHostAccess(c, permissions = chrome.permissions) {
  if (c.where !== "remote" || !c.host) return true;
  const origins = [`http://${c.host}/*`];
  if (await permissions.contains({ origins })) return true;
  return permissions.request({ origins });
}

// ---- testing -----------------------------------------------------------------------

/**
 * Pings the receiver. Resolves to { state, message } where state is one of:
 *   "ok"           reachable and accepted
 *   "needs-code"   reachable but wants an access code and none was given
 *   "wrong-code"   reachable, but the code is wrong
 *   "no-address"   remote selected but no address typed
 *   "unreachable"  nothing answered (server off, wrong address, firewall, tunnel down…)
 */
export async function testConnection(c, fetchFn = fetch, timeoutMs = 4000) {
  const base = receiverBase(c);
  if (!base) return { state: "no-address", message: "Enter the address of the VM or computer." };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/health`, { headers: requestHeaders(c), signal: ctl.signal });
    const info = await res.json();
    if (info.authRequired && !c.token) return { state: "needs-code", message: "Reached it — now enter the access code shown on that machine." };
    if (info.authRequired && !info.authorized) return { state: "wrong-code", message: "Reached it, but the access code is wrong." };
    return { state: "ok", message: "Connected." };
  } catch {
    return {
      state: "unreachable",
      message: c.where === "remote"
        ? "Can't reach it. Check the address, that the installer ran there with \"different computer\" = Yes, and that both are on the same network."
        : "Can't reach the server on this computer. Run the installer (Install-…) once, or open your agent so it starts the server.",
    };
  } finally {
    clearTimeout(timer);
  }
}
