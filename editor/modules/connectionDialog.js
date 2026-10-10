/**
 * connectionDialog.js
 * --------------------------------------------------------------------------
 * The "Agent connection" window: a plain form over connection.js.
 *
 *   ( ) On this computer              — the agent runs where Chrome runs
 *   ( ) In a VM or another computer   — enter its address + access code
 *   [Test connection]   [Cancel] [Save]
 *
 * Nothing is saved until Save; Test uses what is currently typed.
 * -------------------------------------------------------------------------- */

import {
  normalizeConnection, receiverBase, ensureHostAccess, testConnection, describeConnection,
  loadConnection, saveConnection,
} from "./connection.js";

/** Small DOM helper: el("div", {class:"x"}, child, "text"). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/**
 * Creates the dialog (hidden). `onSaved(connection)` fires after Save.
 * Returns { open(connection), close() }.
 */
export function createConnectionDialog({ onSaved }) {
  const radios = {
    local: el("input", { type: "radio", name: "conn-where", id: "conn-local" }),
    remote: el("input", { type: "radio", name: "conn-where", id: "conn-remote" }),
  };
  const hostInput = el("input", { type: "text", id: "conn-host", placeholder: "e.g. 192.168.64.5", spellcheck: "false", autocomplete: "off" });
  const portInput = el("input", { type: "number", id: "conn-port", min: "1", max: "65535" });
  const codeInput = el("input", { type: "text", id: "conn-code", placeholder: "ABCD-2345", spellcheck: "false", autocomplete: "off" });
  const status = el("div", { class: "conn-status", id: "conn-status", role: "status" });
  const testBtn = el("button", { id: "conn-test", type: "button" }, "Test connection");
  const saveBtn = el("button", { id: "conn-save", type: "button", class: "primary" }, "Save");
  const cancelBtn = el("button", { id: "conn-cancel", type: "button" }, "Cancel");

  const remoteFields = el("div", { class: "conn-remote-fields", id: "conn-remote-fields" },
    el("p", { class: "conn-help" },
      "On the VM / other computer, run the installer and answer ", el("b", {}, "Yes"),
      " to “different computer”. It prints an address and an access code — type them here. ",
      "(Ubuntu: ", el("code", {}, "ip a"), " also shows the address; or run ", el("code", {}, "node lan.js status"), " in the mcp-server folder.)"),
    el("label", {}, "Address", hostInput),
    el("div", { class: "conn-row" },
      el("label", {}, "Port", portInput),
      el("label", { class: "grow" }, "Access code", codeInput)));

  const box = el("div", { class: "conn-box", role: "dialog", "aria-modal": "true", "aria-label": "Agent connection" },
    el("h2", {}, "Where does your coding agent run?"),
    el("label", { class: "conn-choice" }, radios.local, el("span", {}, el("b", {}, "On this computer"), el("small", {}, "Chrome and the agent (Cursor, Claude Code, opencode, Antigravity…) are on the same machine."))),
    el("label", { class: "conn-choice" }, radios.remote, el("span", {}, el("b", {}, "In a VM or another computer"), el("small", {}, "e.g. Chrome on your Mac, agent in a VMware Fusion Ubuntu VM."))),
    remoteFields, status,
    el("div", { class: "conn-actions" }, testBtn, el("span", { class: "grow" }), cancelBtn, saveBtn));

  const overlay = el("div", { class: "conn-overlay hidden", id: "conn-overlay" }, box);
  document.body.append(overlay);

  /** Reads the form into a normalized connection. */
  const readForm = () => normalizeConnection({
    where: radios.remote.checked ? "remote" : "local",
    host: hostInput.value, port: portInput.value, token: codeInput.value,
  });

  function showStatus(state, message) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function syncVisibility() {
    remoteFields.classList.toggle("hidden", !radios.remote.checked);
    showStatus("", "");
  }
  radios.local.addEventListener("change", syncVisibility);
  radios.remote.addEventListener("change", syncVisibility);

  /** Runs the permission prompt (needs the click) then the ping; shared by Test and Save. */
  async function check(conn) {
    if (conn.where === "remote" && !conn.host) return { state: "no-address", message: "Enter the address of the VM or computer." };
    if (!(await ensureHostAccess(conn))) return { state: "denied", message: "Chrome needs permission to reach that address — press Test again and choose Allow." };
    return testConnection(conn);
  }

  testBtn.addEventListener("click", async () => {
    showStatus("busy", "Testing…");
    const r = await check(readForm());
    showStatus(r.state, r.message);
  });

  saveBtn.addEventListener("click", async () => {
    const conn = readForm();
    // A remote setup without an address can't work; say so instead of silently saving it.
    if (conn.where === "remote" && !conn.host) { showStatus("no-address", "Enter the address of the VM or computer."); return; }
    if (!(await ensureHostAccess(conn))) { showStatus("denied", "Chrome needs permission to reach that address — press Save again and choose Allow."); return; }
    await saveConnection(conn);
    overlay.classList.add("hidden");
    onSaved(conn);
  });

  cancelBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.classList.add("hidden"); });

  return {
    open(conn) {
      radios[conn.where].checked = true;
      hostInput.value = conn.host; portInput.value = conn.port; codeInput.value = conn.token;
      syncVisibility();
      overlay.classList.remove("hidden");
      (conn.where === "remote" ? hostInput : testBtn).focus();
    },
    close: () => overlay.classList.add("hidden"),
  };
}

export { loadConnection, describeConnection, receiverBase };
