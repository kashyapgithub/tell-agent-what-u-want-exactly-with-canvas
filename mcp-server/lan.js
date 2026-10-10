/**
 * lan.js
 * --------------------------------------------------------------------------
 *   node lan.js on       let another computer (e.g. the Mac hosting this VM) send sketches here
 *   node lan.js off      back to this-computer-only
 *   node lan.js status   show the address + access code to type into the extension
 *
 * Turning it on creates an access code (kept until you turn it off) so only
 * someone who sees it on this screen can send sketches over the network.
 * -------------------------------------------------------------------------- */

import os from "node:os";
import { execSync } from "node:child_process";
import { readConfig, writeConfig, newAccessCode, lanAddresses } from "./lib/config.js";

const PORT = Number(process.env.PORT) || 5959;

/** Restarts the autostarted server (if installed) so it picks up the new setting. Best-effort. */
function restartService() {
  try {
    if (process.platform === "darwin") execSync(`launchctl kickstart -k gui/${os.userInfo().uid}/com.uisketch.server`, { stdio: "ignore" });
    else if (process.platform === "linux") execSync("systemctl --user restart ui-sketch-server", { stdio: "ignore" });
  } catch { /* not installed yet — setup.js will start it with the new config */ }
}

function printStatus() {
  const c = readConfig();
  if (!c.lan) { console.log("\nOther computers: OFF (this computer only).\n"); return; }
  const addrs = lanAddresses();
  console.log("\n==============  Enter these in the UI Sketch extension  ==============");
  console.log("  (Agent connection → \"In a VM or another computer\")\n");
  console.log(`  Address:      ${addrs.length ? addrs.map((a) => a.address).join("   or   ") : "(no network address found)"}`);
  console.log(`  Port:         ${PORT}`);
  console.log(`  Access code:  ${c.token}`);
  console.log("=========================================================================\n");
}

const cmd = process.argv[2] || "status";
if (cmd === "on") {
  const c = readConfig();
  writeConfig({ lan: true, token: c.token || newAccessCode() });
  restartService();
  printStatus();
} else if (cmd === "off") {
  writeConfig({ ...readConfig(), lan: false });
  restartService();
  printStatus();
} else {
  printStatus();
}
