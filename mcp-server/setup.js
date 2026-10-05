/**
 * setup.js
 * --------------------------------------------------------------------------
 * Run once: `npm run setup`. Registers server.js to start automatically
 * every time you log in, using whatever autostart mechanism your OS
 * already has — no terminal, no "npm start", ever again after this.
 *
 * Each platform gets its own small function below because the three OSes
 * have genuinely different autostart mechanisms; there's no way to unify
 * them without hiding what's actually happening. `uninstall.js` reverses
 * whichever one of these ran.
 * -------------------------------------------------------------------------- */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "server.js");
const NODE_PATH = process.execPath; // the exact node binary currently running this script

function installMac() {
  const label = "com.uisketch.server";
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
  const logDir = path.join(os.homedir(), ".ui-sketch-mcp");
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SERVER_PATH}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(logDir, "server.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(logDir, "server.err.log")}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist, "utf8");
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* wasn't loaded — fine */ }
  execSync(`launchctl load -w "${plistPath}"`);
  console.log(`Installed. The UI Sketch server will now start automatically at login.\n(${plistPath})`);
}

function installWindows() {
  const startupDir = path.join(
    os.homedir(),
    "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"
  );
  const vbsPath = path.join(startupDir, "ui-sketch-server.vbs");

  // A .vbs in the Startup folder runs silently (no console window) at every
  // login — this is the standard no-terminal way to autostart on Windows
  // without adding a native-module dependency just to write a .lnk file.
  const vbs =
    `Set WshShell = CreateObject("WScript.Shell")\n` +
    `WshShell.Run """${NODE_PATH}"" ""${SERVER_PATH}""", 0, False\n`;

  fs.writeFileSync(vbsPath, vbs, "utf8");
  execSync(`wscript.exe "${vbsPath}"`); // also start it right now
  console.log(`Installed. The UI Sketch server will now start automatically at login.\n(${vbsPath})`);
}

function installLinux() {
  const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
  const unitPath = path.join(unitDir, "ui-sketch-server.service");
  fs.mkdirSync(unitDir, { recursive: true });

  const unit =
    `[Unit]\nDescription=UI Sketch local receiver + MCP server\n\n` +
    `[Service]\nExecStart=${NODE_PATH} ${SERVER_PATH}\nRestart=on-failure\n\n` +
    `[Install]\nWantedBy=default.target\n`;

  fs.writeFileSync(unitPath, unit, "utf8");
  execSync(`systemctl --user daemon-reload`);
  execSync(`systemctl --user enable --now ui-sketch-server`);
  console.log(`Installed. The UI Sketch server will now start automatically at login.\n(${unitPath})`);
}

const platform = os.platform();
try {
  if (platform === "darwin") installMac();
  else if (platform === "win32") installWindows();
  else if (platform === "linux") installLinux();
  else {
    console.error(`Unrecognized platform "${platform}". Run "node server.js" manually, or add it to your OS's startup apps yourself.`);
    process.exit(1);
  }
} catch (err) {
  console.error("Setup failed:", err.message || err);
  process.exit(1);
}
