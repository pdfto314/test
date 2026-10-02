@echo off
setlocal
REM Gera playlist.json a partir da pasta audio\ (audio\<Grupo>\<Tema>\som.mp3)
REM Normalmente NAO precisa: o GitHub Action faz isso sozinho a cada push.
REM Requisito: Python instalado (https://www.python.org/downloads/)

cd /d "%~dp0.."
where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Instale o Python ou apenas faca Commit + Push:
  echo o GitHub Action atualiza o playlist.json automaticamente.
  pause
  exit /b 1
)

python -m pip install --quiet mutagen
python ferramentas\gerar_playlist.py

echo.
echo Agora: faca Commit + Push do playlist.json
pause
