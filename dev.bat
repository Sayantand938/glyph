@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --legacy-peer-deps || exit /b 1
)
start "" http://localhost:5173
call npm run dev
