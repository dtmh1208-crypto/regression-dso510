@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Build the interface first: npm install, then npm run build.
  pause
  exit /b 1
)
echo Opening Fieldnotes at http://127.0.0.1:8765
echo Keep this window open while using the playground.
python server.py --open-browser
pause
