@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Need Node.js 20+. Install from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)
node scripts\harness.mjs start %*
if errorlevel 1 pause
