@echo off
cd /d "%~dp0"
echo ===============================
echo HEROES - Tudo em 1 clique
echo ===============================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0baixar_heroes_freesound.ps1"
echo.
if exist "%~dp0generate_playlist.bat" (
  echo Gerando playlist.json...
  call "%~dp0generate_playlist.bat"
) else (
  echo Nao achei generate_playlist.bat aqui. Rode ele manualmente depois.
)
echo.
pause
