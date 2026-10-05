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

async function pushToMcpReceiver(port, doc, pngDataUrl) {
  const res = await fetch(`http://localhost:${port}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: doc, pngBase64: pngDataUrl.split(",")[1] }),
  });
  if (!res.ok) {
    throw new Error(`Receiver at localhost:${port} responded ${res.status}. Is the UI Sketch server running? See /mcp-server.`);
  }
}

/**
 * Exports via the selected mode. `rendered` is the engine's renderExport()
 * result ({ canvas, preview }). Returns a short description for the status line.
 */
export async function exportSketch({ mode, folder, port, shapes, rendered, extra }) {
  const doc = buildSketchDocument(shapes, rendered.preview, extra);
  const pngDataUrl = rendered.canvas.toDataURL("image/png");

  if (mode === "mcp") {
    await pushToMcpReceiver(port || 5959, doc, pngDataUrl);
    return `localhost:${port || 5959}`;
  }

  const cleanFolder = (folder || "ui-sketches").replace(/^\/+|\/+$/g, "");
  await downloadFile(`${cleanFolder}/latest.json`, jsonDataUrl(doc));
  await downloadFile(`${cleanFolder}/latest.png`, pngDataUrl);
  return `${cleanFolder}/latest.json`;
}
