#!/bin/bash
# Double-click installer (macOS: double-click; Linux: run from a terminal or "Run as program").
# Installs the dependency, starts the server at every login, and connects it to your coding agents.
cd "$(dirname "$0")/mcp-server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required first: https://nodejs.org (install, then double-click this again)"
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi
npm install --no-audit --no-fund && node setup.js && node connect.js
echo; echo "Done. Next: load the extension in chrome://extensions (Load unpacked → the 'ui-sketch-extension' folder)."
read -n 1 -s -r -p "Press any key to close"
