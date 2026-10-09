@echo off
rem Double-click installer for Windows: installs deps, autostarts the server, connects your coding agents.
cd /d "%~dp0mcp-server"
where node >nul 2>nul || (echo Node.js is required first: https://nodejs.org & pause & exit /b 1)
call npm install --no-audit --no-fund && node setup.js && node connect.js
echo.
echo Done. Next: load the extension in chrome://extensions (Load unpacked, pick this folder).
pause
