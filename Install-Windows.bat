@echo off
rem Double-click installer for Windows: installs deps, autostarts the server, connects your coding agents.
cd /d "%~dp0mcp-server"
where node >nul 2>nul || (echo Node.js is required first: https://nodejs.org & pause & exit /b 1)
echo.
echo Will you draw in Chrome on a DIFFERENT computer than this one?
set ANSWER=n
set /p ANSWER=Different computer? [y/N] 
if /i "%ANSWER:~0,1%"=="y" (call node lan.js on) else (call node lan.js off >nul 2>nul)
call npm install --no-audit --no-fund && node setup.js && node connect.js
if /i "%ANSWER:~0,1%"=="y" call node lan.js status
echo.
echo Done. Next: load the extension in chrome://extensions (Load unpacked, pick this folder).
pause
