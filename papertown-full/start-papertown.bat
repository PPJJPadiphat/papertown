@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
if not exist .env copy .env.example .env
start "PaperTown Server" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "PaperTown" http://localhost:3000
