@echo off
cd /d "%~dp0"
start "" http://localhost:4101
node notes-app\server.js
