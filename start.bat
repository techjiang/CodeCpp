@echo off
cd /d "%~dp0"
if exist "CodeCpp.exe" (
  start "" "CodeCpp.exe" %*
  exit /b 0
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" . %*
  exit /b 0
)
echo [CodeCpp] Electron runtime not found. Starting browser fallback mode...
echo [CodeCpp] Run "npm install" to enable the desktop application.
node server\index.js %*
