/**
 * uninstall.js
 * --------------------------------------------------------------------------
 * Run `npm run uninstall-setup` to remove whatever autostart entry
 * setup.js created. Safe to run even if setup was never run — each branch
 * just no-ops if its file/service doesn't exist.
 * -------------------------------------------------------------------------- */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function uninstallMac() {
  const plistPath = path.join(os.homedir(), "Library/LaunchAgents/com.uisketch.server.plist");
  if (!fs.existsSync(plistPath)) { console.log("Nothing installed."); return; }
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* already unloaded */ }
  fs.rmSync(plistPath);
  console.log("Removed the autostart entry.");
}

function uninstallWindows() {
  const vbsPath = path.join(
    os.homedir(),
    "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
    "ui-sketch-server.vbs"
  );
  if (!fs.existsSync(vbsPath)) { console.log("Nothing installed."); return; }
  fs.rmSync(vbsPath);
  console.log("Removed the autostart entry. (The currently running server, if any, keeps running until you close it.)");
}

function uninstallLinux() {
  const unitPath = path.join(os.homedir(), ".config/systemd/user/ui-sketch-server.service");
  if (!fs.existsSync(unitPath)) { console.log("Nothing installed."); return; }
  try { execSync(`systemctl --user disable --now ui-sketch-server`, { stdio: "ignore" }); } catch { /* already stopped */ }
  fs.rmSync(unitPath);
  execSync(`systemctl --user daemon-reload`);
  console.log("Removed the autostart entry.");
}

const platform = os.platform();
if (platform === "darwin") uninstallMac();
else if (platform === "win32") uninstallWindows();
else if (platform === "linux") uninstallLinux();
else console.log(`Unrecognized platform "${platform}" — nothing to do.`);
