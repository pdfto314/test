@echo off
cd /d "%~dp0"
echo ===============================
echo HEROES - Downloader Freesound
echo ===============================
echo.
echo 1) Defina a chave (uma vez):
echo    setx FREESOUND_API_KEY "SUA_CHAVE"
echo.
echo Rodando downloader...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0baixar_heroes_freesound.ps1"
echo.
echo Finalizado.
pause
