#!/bin/bash
# Double-click installer (macOS: double-click; Linux: run from a terminal or "Run as program").
# Installs the dependency, starts the server at every login, and connects it to your coding agents.
cd "$(dirname "$0")/mcp-server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required first: https://nodejs.org (install, then double-click this again)"
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi

echo
echo "Will you draw in Chrome on a DIFFERENT computer than this one?"
echo "(e.g. this is a VM, and Chrome runs on the Mac that hosts it)"
read -r -p "Different computer? [y/N] " ANSWER
case "$ANSWER" in [yY]*) node lan.js on ;; *) node lan.js off >/dev/null 2>&1 ;; esac

npm install --no-audit --no-fund && node setup.js && node connect.js
case "$ANSWER" in [yY]*) node lan.js status ;; esac
echo; echo "Done. Next: load the extension in chrome://extensions (Load unpacked → the 'ui-sketch-extension' folder)."
read -n 1 -s -r -p "Press any key to close"
