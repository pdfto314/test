@echo off
setlocal
cd /d "%~dp0"
echo Gerando playlist.json a partir de .\audio\* (sem Python)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate_playlist.ps1"
if %errorlevel% neq 0 (
  echo.
  echo ERRO ao gerar playlist.json.
  pause
  exit /b 1
)
echo.
echo OK. Agora faca Commit + Push no GitHub Desktop.
pause
