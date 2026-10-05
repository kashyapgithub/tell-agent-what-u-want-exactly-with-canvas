# UI Sketch — Local Canvas

A tiny Chrome extension: draw a rough UI sketch, hit one button, and it lands
as a file inside your project folder — no Figma, no manual export/import,
no GitHub round-trip.

## Install (unpacked, ~30 seconds)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder (`ui-sketch-extension`).
4. Pin the extension and click its icon — it opens the canvas in a new tab.

## Two ways to send a sketch — pick per export

The toolbar's **Send via** dropdown switches between them; your choice and
its settings (folder / port) are remembered.

### A. Local file (simplest, no server to run)

The Chrome Downloads API can only write inside Chrome's *default downloads
folder* — it can't take an arbitrary absolute path. So instead of fighting
that, just make your project the default downloads folder, once:

1. `chrome://settings/downloads`
2. Set **Location** to your project's repo root (or a folder inside it, e.g.
   `~/projects/my-app`).
3. Leave "Ask where to save each file" **off**.

The **Folder** field (default `ui-sketches`) is a subfolder *inside* that
downloads location, so exporting writes to:

```
~/projects/my-app/ui-sketches/latest.json
~/projects/my-app/ui-sketches/latest.png
```

Every export overwrites the same two files. Your agent just reads that path
directly — works with any agent that can read files in the repo, no setup
on the agent's side.

### B. MCP server (fully automatic after one-time setup)

Best when you don't want to hijack Chrome's download folder, or you want
the agent to fetch the sketch as a tool call rather than reading a file.

**One-time setup — after this, you never run a command again:**

```bash
cd mcp-server
npm install
npm run setup       # registers the server to start automatically at login
```

`npm run setup` works on macOS (via `launchd`), Windows (via the Startup
folder), and Linux (via `systemctl --user`) — it detects your OS
automatically. From then on, `server.js` is just running in the background,
always, the same way your OS keeps any other login item running. To remove
it later: `npm run uninstall-setup`.

If you'd rather not install anything at login, that's fine too — the same
`server.js` is what your coding agent spawns automatically once you register
it (next step), so on days you have Cursor/Claude Code/Antigravity open
anyway, it's already running with zero setup. The only gap that covers is
exporting a sketch before opening any agent for that session — `npm run
setup` closes that gap; if you skip it, just open your agent first.

Either way, it stores exports under `~/.ui-sketch-mcp/`, independent of any
project folder — the extension talks to it over `localhost:5959` by default
(change the **Port** field in the toolbar if you customize `PORT`).

**Register it with your agent** — same `server.js`, using an **absolute path**:

```json
{
  "mcpServers": {
    "ui-sketch": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/server.js"]
    }
  }
}
```

- **Cursor:** put this in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).
- **Claude Code:** `claude mcp add ui-sketch -- node /absolute/path/to/mcp-server/server.js`
- **Antigravity:** same `mcpServers` JSON shape, in its MCP settings.

(Check each tool's current docs if the config location has moved — the
JSON shape above is the common denominator across all of them.)

Once registered, the agent has a `get_latest_sketch` tool that returns the
sketch JSON plus a PNG preview — no file path involved on its end at all.

## Using the canvas

**The tool dock** (floating at the bottom, like Figma's). Each group's button shows the tool you used last from it; the ▾ opens the rest.

| Group | Tools |
|---|---|
| **Move** ▾ | Move (V), Hand tool (H), Scale (K) |
| **Frame** ▾ | Frame (F), Section (⇧S), Slice (S) |
| **Shape** ▾ | Rectangle (R), Line (L), Arrow (⇧L / A), Ellipse (O), Polygon, Star, Image… (file picker) |
| **Pen** ▾ | Pen (P) — vector paths with bezier curves; Pencil (⇧P) — freehand |
| **Text** | Text (T) |
| **Comment** | Comment (C) |
| **Connector** | Flow connector (X) — for diagrams |
| **Actions** (grid icon) | The command palette, **Ctrl/Cmd+K** |
| **Design / Dev** tabs | Switch to Dev mode (below) |

**Navigation:**

| Action | How |
|---|---|
| Pan | scroll / two-finger scroll, or hold **Space** and drag, or middle-mouse drag |
| Zoom | **Ctrl/Cmd + scroll**, trackpad pinch, or the toolbar buttons (10%–800%) |
| Zoom in / out / 100% | Ctrl/Cmd `+` / `-` / `0` |
| Fit everything | **Shift + 1**, or the Fit button |

**Selecting:**

- Click a shape; **Shift-click** adds/removes; **drag on empty canvas** to box-select (Shift adds to the current selection); **Ctrl/Cmd+A** selects all.
- Clicking one member of a multi-selection (without dragging) narrows to it.
- Everything works on the whole selection: move, resize (the box around it), nudge, delete, duplicate, copy/cut/paste, style, z-order, undo.
- **Groups:** Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups. Clicking a member selects the whole group; **double-click** enters it to pick one member.
- **Lock / hide** from the layers panel (or Ctrl/Cmd+Shift+L / H). Locked shapes can't be picked, moved or resized on the canvas; hidden shapes are not drawn and **not exported**.

**Transforming:**

- **Resize:** 8 handles on boxes/images, endpoint handles on lines/arrows, a corner handle on text (scales the font), and a box with 8 handles around a multi-selection. **Shift** locks aspect ratio (images lock by default; Shift frees them).
- **Rotate:** drag the knob above a rectangle/ellipse/image/text (Shift snaps to 15°), or type a value in the Rotate box. Rotated shapes resize correctly (the opposite edge stays put).
- **Smart guides:** while dragging, edges/centres snap to other shapes and red guide lines appear. Hold **Ctrl/Cmd** to turn snapping off; hold **Shift** to lock to one axis.
- **Align / distribute:** the toolbar icons align a selection (2+ shapes) left / centre / right / top / middle / bottom, and distribute 3+ shapes with equal gaps.
- **Draw with Shift:** squares/circles, and lines snapped to 45°.
- **Keyboard:** arrow keys nudge 1px (Shift: 10px); Ctrl/Cmd+D duplicate; Ctrl/Cmd+`]` / `[` forward / backward (Shift for front / back); Delete removes; Esc deselects; Ctrl/Cmd+Z / Shift+Z undo / redo; Ctrl/Cmd+C / X / V copy / cut / paste.

**Layers panel** (toggle with the Layers button): frontmost first. Click to select (Shift/Ctrl adds), eye to hide, padlock to lock, **double-click a name to rename**, **drag a row** to reorder.

**Text:** click with the Text tool; **double-click** existing text to edit (emptying it deletes it). **Size** sets the font size.

**Reference images:** drag a file onto the canvas, or paste (Ctrl/Cmd+V) — most OS screenshot tools copy to the clipboard, so "screenshot → paste" needs no save dialog. Images over 1600px on the longest side are downscaled on import so exports stay small. (If the clipboard has no image, Ctrl/Cmd+V pastes shapes you copied.)

**Style panel:** Stroke, Fill, Width, Radius, Opacity, Gradient, Dashed, Elbow (connector routing), Size, Rotate, and **Effects** (below). They apply to the whole selection and also set the default for the next shape; selecting a shape loads its real values into the controls.

**Send to project:** exports via whichever mode is selected above. The preview PNG is rendered offscreen — cropped to your content, white background, no selection handles.

### Effects (Figma-style)

The toolbar's **Effects** button opens a panel like Figma's. Press **+** to add any of the eight effects, stack as
many as you like, click one to edit it, use the eye to hide it and **−** to remove it. With shapes selected it edits
their effects (all selected shapes get the same list); with nothing selected it sets the default for new shapes.

| Effect | Parameters |
|---|---|
| **Drop shadow** | X, Y, Blur, Spread (negative shrinks), Color + opacity, *Show behind transparent areas* |
| **Inner shadow** | X, Y, Blur, Spread, Color + opacity |
| **Layer blur** | Blur |
| **Background blur** | Blur — blurs what's behind the shape, visible through it |
| **Noise** | Type (mono / duo / multi), Size, Density, Color(s), Opacity, Blend mode |
| **Texture** | Size, Radius, Opacity, *Clip to shape* — a lit bump map |
| **Glass** | Light (intensity, angle), Refraction, Depth, Dispersion, Frost, Splay |
| **Shader** *(beta)* | Preset (mesh / waves / plasma), 3 colors, Scale, Seed, Opacity, Blend |

Effects compose in Figma's order: backdrop effects, drop shadows, the shape, inner shadow / noise / texture / shader /
glass rim, then layer blur. They render at screen resolution (so they stay crisp when you zoom) and work on every
shape type, including text, images and rotated shapes. Each effect is stored in the exported JSON with all its
parameters, so an agent can reproduce it.

**Honest notes on fidelity.** Drop shadow, inner shadow, layer blur, background blur and noise are faithful
equivalents of Figma's. **Texture, Glass and Shader are my own approximations** of Figma's effects — Figma's exact
algorithms aren't public, and its Shader is a custom-code beta, so mine are three procedural presets. Glass uses a
frosted, magnified backdrop plus lit/shaded rims and colour fringing rather than true per-pixel refraction. Shadow
*spread* is approximated by stamping the shape around a ring, which is exact for opaque shapes but slightly denser
where translucent shapes overlap themselves.

### Frames, sections and slices

Frames are for screens. Draw one (F), then anything you draw inside it **becomes its child**: children move with the
frame, are **clipped** to it, nest under it in the layers panel, and are saved with a `parentId`. Frames can nest in
frames and sections; **Ctrl/Cmd+Alt+G** wraps the current selection in a new frame.

- **Move a frame by its name label** (above the top-left corner) or by clicking its empty area; clicking a child selects the child.
- Dropping a shape into/out of a frame re-parents it; deleting a frame deletes what's inside; duplicating copies the contents.
- **Section** is a grey, non-clipping container for organising frames. **Slice** marks an export region (dashed orange, never part of an export).
- **Export scope — this is the useful bit for an agent:** select exactly one frame, section or slice and **Send to project**
  sends *just that region* (its own cropped PNG, and only the shapes inside it, with a `scope` block). Select anything else
  and the whole canvas goes, with the slices listed under `slices` so the agent knows the regions.

### Comments

Press **C** and click to drop a note pin. Type your note and press **Post** (Ctrl/Cmd+Enter); click a pin to edit it,
**Resolve**, or **Delete**. Pins are real layers (undo, move, layers panel). In the export they become **numbered pins on
the PNG** and a `notes` list in the JSON — each note has its text, position, whether it's resolved, and the **shape it sits
on** (`nearShapeName`). That makes "make this button rounder" something an agent can act on directly.

### Pen, Pencil, polygon, star, image

- **Pen (P):** click for corner points; **click-and-drag** for smooth points with bezier handles; click the first point to
  **close** the path (it gets a fill), or press Enter / double-click / Esc to finish it open. Backspace removes the last point.
  **Double-click (or Enter) a path to edit its nodes**: drag anchors and handles (Alt breaks handle symmetry), Delete removes a node.
  Paths export their anchors/handles **and the SVG path data (`d`)**.
- **Pencil (⇧P):** smoothed freehand, simplified on release.
- **Polygon / Star:** the **Points** and **Inner** boxes in the toolbar set the number of sides/points and a star's inner radius.
- **Image…:** opens a file picker (or drag/paste as before).
- **Hand (H)** pans with the left mouse button; **Scale (K)** scales the selection proportionally *including* stroke widths,
  corner radii, font sizes, effect sizes and the contents of frames (unlike the resize handles, which only change geometry).

### Actions menu (Ctrl/Cmd+K)

A searchable command palette: tools, edit commands, align/distribute, z-order, lock/hide, **add any effect**, zoom, toggle
panels, Design/Dev mode, and Send to project. Type to filter (every word must match), ↑/↓ to move, Enter to run, Esc to close.

### Dev mode

The **</>** tab makes the canvas **read-only** (nothing can be edited from the canvas, panels, shortcuts or Actions — only
selecting, panning, zooming and comments) and opens an **Inspect** panel for the selected layer: position (relative to its frame),
size, colours, effects, and **generated CSS** with a Copy button. Mapping: drop/inner shadow → `box-shadow` (`inset`), layer
blur → `filter`, background blur / glass frost → `backdrop-filter`, polygon/star → `clip-path`, paths → SVG data. Effects with
no CSS equivalent (noise, texture, shader, glass rim light) are listed as comments, not silently dropped.

### Flow connector — for architecture / data-flow diagrams

This is the one that matters for explaining a system to an agent, not just
a screen: draw a couple of boxes (rect tool), label them (text tool), then
switch to the connector tool (X) and drag from one box to another. The
resulting arrow doesn't store a fixed position — it always points from
whichever box you dragged from to whichever box you dragged to, computed
fresh every frame. Rearrange your boxes afterward and the arrows follow
automatically, the same way a real flowchart tool behaves.

- Double-click a connector to give it a label (e.g. "POST /save").
- Tick **elbow** for right-angle routing (the usual architecture-diagram look) — before drawing to make new connectors elbow, or with a connector selected to switch it. **dashed** works on connectors too.
- A connector can only be selected, deleted, or labeled — it's not
  draggable itself, since its whole point is that it's derived from the
  two boxes it connects.
- It must start and end on an existing shape — dragging to empty canvas
  cancels it.

## How good is it, really? (honest version)

**Where it stands.** This now covers the core of Figma's canvas: pan/zoom, multi-select
(click / shift / marquee / select-all), groups, layers (hide / lock / rename / reorder),
snapping with smart guides, align / distribute, rotation, copy / cut / paste,
undo/redo, and export. It is still a lightweight tool, not a Figma replacement.

**Performance.** Measured with a real canvas implementation in Node: rendering 300
rounded, shadowed shapes at 2× takes ~4 ms/frame, so drawing speed isn't the bottleneck for
sketch-sized documents. Renders coalesce to one per animation frame; undo history shares
embedded screenshots instead of deep-copying them (13.6 ms → 0.05 ms per commit with a 3 MB
image); freehand strokes are simplified on release (200 points → 13).

**Verification.** ~450 automated checks: the interaction logic (drawing, dragging, resizing,
selection, groups, snapping, alignment, clipboard, layers, rotation math, elbow routing),
real-pixel rendering and export, and a DOM-level test that loads the actual `editor.html` +
`main.js` in jsdom and drives the real buttons, layers panel and export. Several tests were
confirmed to fail when their bug is reintroduced.

**Still not Figma** — notably missing:

- **Draw and Prototype modes** (the other two tabs in Figma's toolbar) — only Design and Dev exist. No interactive prototyping.
- **Auto-layout, constraints, components/variants, styles/variables, boolean operations, masks, blend modes on layers.**
- The Actions menu is a **command palette only** — no plugins, widgets or AI actions like Figma's.
- Pen: no adding a node by clicking on a segment, no per-handle types beyond mirrored/Alt-broken, no vector networks.
- Snapping works while *moving* only (not resizing/drawing), with no spacing/distance guides.
- No flip, per-corner radius, stroke position/caps/arrowheads; one font; one-line text.
- Groups are flat; the layers panel has no collapse/expand and dropping a layer makes it a sibling, not a child.
- Connectors attach to the facing edge (no chosen connection point) and elbow routes don't avoid other shapes.
- Texture, Glass and Shader are my approximations of Figma's effects (see the Effects notes); Dev-mode CSS is the closest
  equivalent, not pixel-identical.
- No collaboration. Images are embedded in the JSON as base64.

**Tested vs. not tested.** Not tested in a real Chrome window: how the dock, popovers and panels actually *look* (all CSS is
unviewed — I could only render the canvas), the focus timing of the text and comment boxes, trackpad pinch feel, drag-and-drop
feel in the layers panel, `chrome.downloads`, and the MCP round trip from the browser. If something misbehaves there, look there first.

## What gets written — `latest.json`

This is the file your agent should read. Shape coordinates are CSS pixels,
origin at the canvas's top-left corner.

```json
{
  "schema": "ui-sketch/v1",
  "exportedAt": "2026-09-29T10:00:00.000Z",
  "canvas": { "note": "Shape coordinates are in world units (CSS pixels), y grows downward." },
  "preview": { "file": "latest.png", "origin": { "x": 16, "y": 26 }, "width": 780, "height": 380, "pixelRatio": 2 },
  "shapes": [
    {
      "id": "s1",
      "type": "rect",
      "x": 40, "y": 40, "w": 200, "h": 80,
      "stroke": "#e8e8ec", "fill": "#3a5bd9", "strokeWidth": 2,
      "cornerRadius": 12, "opacity": 1, "shadow": null, "gradient": null
    },
    {
      "id": "s2",
      "type": "text",
      "x": 60, "y": 60,
      "text": "Login button", "fontSize": 18, "stroke": "#e8e8ec"
    },
    {
      "id": "s3",
      "type": "connector",
      "fromId": "s1", "toId": "s2",
      "label": "on click", "stroke": "#e8e8ec", "strokeWidth": 2
    }
  ]
}
```

`preview` describes the PNG: it is cropped to your content, and a shape at world
(x, y) appears at pixel `((x - origin.x) * pixelRatio, (y - origin.y) * pixelRatio)`.

`type` is one of `rect`, `ellipse`, `polygon`, `star`, `line`, `arrow`, `connector`, `pen` (freehand), `path` (vector),
`text`, `image`, `frame`, `section`, `slice`. Comments are not in `shapes`; they are in the top-level `notes` list.

- `line`/`arrow` use `x1,y1,x2,y2` instead of `x,y,w,h`.
- `connector` uses `fromId`/`toId` (referencing other shapes' `id`) instead
  of any coordinates at all — resolve its actual position by looking up
  those shapes' `x,y,w,h` yourself if you need the geometry; otherwise
  just treat it as "an arrow from the thing with this id to the thing with
  that id, labeled thus."
- `pen` uses a `points` array of `{x,y}`. `path` uses `nodes` (`{x,y,hin,hout}` with absolute handle points) plus `closed`, and an exported `d` (SVG path data).
- `parentId` is the containing frame/section (children come after their parent). `effects` is an ordered list of effect objects with all parameters.
- Top-level extras: `scope` (when one frame/section/slice was exported), `slices`, and `notes` (numbered comments with `nearShapeId`/`nearShapeName`).
- Every shape also has `name` (layer name), `rotation` (degrees), `dashed`, `groupId`
  (shapes sharing one belong to the same group), and connectors have `route`
  (`"straight"` or `"elbow"`). `hidden`/`locked` are editor state; **hidden shapes are not exported**.
- `image` uses `x,y,w,h` for placement/size plus `src` (a `data:` URL — the
  actual pixels).
- `cornerRadius` (rect only), `opacity`, `shadow` (`{color,blur,offsetX,offsetY}`
  or `null`), and `gradient` (`{from,to,angle}` or `null`, rect/ellipse only)
  appear on every shape but only have visible effect on the types noted.

A one-line prompt that works well with a coding agent:

> Read `ui-sketches/latest.json` in this repo — it's a rough sketch I drew
> (rectangles are components/nodes, text labels name them, connectors show
> flow between them). Build the actual UI / architecture based on that layout.

## Files in this extension

```
manifest.json        Extension manifest (MV3)
background.js         Opens the editor tab when the icon is clicked
editor/
  editor.html          Toolbar + canvas markup
  editor.css           Styling
  main.js              Entry point — wires the modules together
  modules/
    shapes.js            Shape data model + per-shape rendering (incl. effects)
    connectors.js          Flow-diagram connectors — geometry, drawing, hit-testing
    canvasEngine.js         Viewport (zoom/pan), rAF rendering, offscreen export
    tools.js                 Pointer/keyboard interaction, selection, drawing, connectors
    transform.js               Stateless move/resize/rotate geometry (rotation-aware, group resize)
    selection.js                Groups, hit picking, marquee, selection bounds
    snapping.js                  Smart guides / snap-to-edges while dragging
    align.js                      Align + distribute
    clipboard.js                   Clone/paste (fresh ids, remapped connectors and groups)
    layersPanel.js                 Layers list: select, hide, lock, rename, reorder
    effectsModel.js                 The 8 effect types, their Figma-style defaults, extent maths
    effects.js                       Effect renderer: offscreen layers, blur/shadows/glass, caching
    procedural.js                     Seeded generators: grain, bump-map texture, shader presets
    effectsPanel.js                    The Effects popover (add menu, rows, parameter editors)
    icons.js                            Shared inline SVG icons
    toolRegistry.js                      The tool groups, icons and shortcuts the dock is built from
    dock.js                               Figma-style floating tool dock (menus, shortcuts, mode tabs)
    hierarchy.js                           Frame/section parent-child structure and ordering
    overlays.js                             Frame labels, comment pins, pen/node-edit visuals
    exportScope.js                           What gets exported: whole canvas, or one frame/slice (+ notes)
    path.js                                   Vector path geometry: curves, bounds, hit-testing, SVG data
    comments.js                                The comment box
    actions.js                                  Actions command palette
    inspect.js                                   Dev mode: CSS generator + Inspect panel
    viewportControls.js         Wheel/pinch/Space-drag pan & zoom, zoom shortcuts
    imageImport.js             Drag-and-drop + clipboard paste for reference screenshots
    history.js                  Undo/redo stack
    toolbar.js                   DOM wiring for toolbar controls
    exporter.js                   JSON + PNG export — local file or push to MCP receiver
mcp-server/
  package.json            Scripts: start, setup (autostart install), uninstall-setup
  lib/storage.js           Shared read/write for ~/.ui-sketch-mcp/latest.{json,png}
  server.js                 Merged process: HTTP receiver + MCP server (stdio)
  setup.js                   One-time autostart installer (macOS/Windows/Linux)
  uninstall.js                Removes whatever setup.js installed
```
