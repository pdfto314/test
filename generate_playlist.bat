@echo off
setlocal
cd /d "%~dp0"

echo Gerando playlist.json a partir das pastas em .\audio\...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate_playlist.ps1"
if %errorlevel% neq 0 (
  echo.
  echo ERRO ao gerar playlist.json.
  pause
  exit /b 1
)

echo.
echo OK. Agora abra o GitHub Desktop e faca Commit + Push.
pause
