@echo off
cd /d "%~dp0"
echo Gerando playlist.json com Python...
py gerar_playlist.py
if errorlevel 1 (
  echo.
  echo ERRO ao gerar playlist.json
  pause
  exit /b 1
)
echo.
echo OK. Agora faca Commit + Push no GitHub Desktop.
pause
