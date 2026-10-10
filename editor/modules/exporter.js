/**
 * exporter.js
 * --------------------------------------------------------------------------
 * Two ways to hand a sketch to an AI coding agent — the toolbar's "Send via"
 * dropdown picks which runs:
 *
 *   "local" — writes <folder>/latest.json + latest.png via chrome.downloads
 *             (conflictAction "overwrite", so re-exporting replaces the same
 *             two files). Needs Chrome's default download folder pointed at
 *             your project — see the README.
 *
 *   "mcp"   — POSTs the same data to the local server (see /mcp-server), which
 *             an MCP-aware agent reads through its `get_latest_sketch` tool.
 *
 * The PNG is rendered offscreen by the engine (cropped to the content, white
 * background, no selection handles) — never a screenshot of the live canvas.
 * -------------------------------------------------------------------------- */

import { receiverBase, requestHeaders, describeConnection } from "./connection.js";

/**
 * Builds the JSON document. `preview` tells a reader how the PNG maps onto the
 * shape coordinates:  pixel = (world - origin) * pixelRatio.
 */
export function buildSketchDocument(shapes, preview, extra = {}) {
  return {
    schema: "ui-sketch/v1",
    exportedAt: new Date().toISOString(),
    canvas: { note: "Shape coordinates are in world units (CSS pixels), y grows downward." },
    preview: { file: "latest.png", ...preview },
    ...(extra.scope ? { scope: extra.scope } : {}),
    ...(extra.slices && extra.slices.length ? { slices: extra.slices } : {}),
    ...(extra.notes && extra.notes.length ? { notes: extra.notes } : {}),
    shapes,
  };
}

function downloadFile(filename, url) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        reject(chrome.runtime.lastError || new Error("Download failed"));
      } else {
        resolve(downloadId);
      }
    });
  });
}

const jsonDataUrl = (doc) =>
  `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(doc, null, 2))))}`;

async function pushToMcpReceiver(conn, doc, pngDataUrl) {
  const base = receiverBase(conn);
  if (!base) throw new Error("No address set — open “Agent connection” and enter the VM or computer address.");
  let res;
  try {
    res = await fetch(`${base}/save`, {
      method: "POST",
      headers: requestHeaders(conn, { "Content-Type": "application/json" }),
      body: JSON.stringify({ json: doc, pngBase64: pngDataUrl.split(",")[1] }),
    });
  } catch {
    throw new Error(`Can't reach ${describeConnection(conn)} — open “Agent connection” and press Test.`);
  }
  if (res.status === 401) throw new Error("Wrong access code — open “Agent connection” and re-enter it.");
  if (!res.ok) throw new Error(`The server at ${describeConnection(conn)} answered ${res.status}.`);
}

/**
 * Exports via the selected mode. `rendered` is the engine's renderExport()
 * result ({ canvas, preview }). Returns a short description for the status line.
 */
export async function exportSketch({ mode, folder, connection, shapes, rendered, extra }) {
  const doc = buildSketchDocument(shapes, rendered.preview, extra);
  const pngDataUrl = rendered.canvas.toDataURL("image/png");

  if (mode === "mcp") {
    await pushToMcpReceiver(connection, doc, pngDataUrl);
    return describeConnection(connection);
  }

  const cleanFolder = (folder || "ui-sketches").replace(/^\/+|\/+$/g, "");
  await downloadFile(`${cleanFolder}/latest.json`, jsonDataUrl(doc));
  await downloadFile(`${cleanFolder}/latest.png`, pngDataUrl);
  return `${cleanFolder}/latest.json`;
}
