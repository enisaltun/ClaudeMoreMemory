@echo off
cd /d "%~dp0"
start "" http://localhost:4102
node graph-app\server.js
