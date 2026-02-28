@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM generate_playlist.bat (recursivo, sem Python)
REM - Varre .\audio\* recursivamente
REM - Cria/atualiza playlist.json

if not exist "audio\" (
  echo ERRO: pasta "audio\" nao existe.
  pause
  exit /b 1
)

set "OUT=playlist.json"

> "%OUT%" echo {
set "FIRST_THEME=1"

for /d %%T in ("audio\*") do (
  set "THEME=%%~nxT"

  set "COUNT=0"
  for /r "%%T" %%F in (*.mp3) do set /a COUNT+=1

  if !COUNT! gtr 0 (
    if "!FIRST_THEME!"=="1" (
      set "FIRST_THEME=0"
      >> "%OUT%" echo   "categories": [
    ) else (
      >> "%OUT%" echo   ,
    )

    >> "%OUT%" echo     {
    >> "%OUT%" echo       "name": "!THEME!",
    >> "%OUT%" echo       "items": [

    set "FIRST_ITEM=1"
    for /r "%%T" %%F in (*.mp3) do (
      set "REL=%%F"
      set "REL=!REL:%CD%\=!"
      set "URL=!REL:\=/!"
      set "TITLE=%%~nF"

      if "!FIRST_ITEM!"=="1" (
        set "FIRST_ITEM=0"
      ) else (
        >> "%OUT%" echo         ,
      )

      >> "%OUT%" echo         {
      >> "%OUT%" echo           "title": "!TITLE!",
      >> "%OUT%" echo           "type": "ambience",
      >> "%OUT%" echo           "url": "!URL!",
      >> "%OUT%" echo           "loop": true,
      >> "%OUT%" echo           "volume": 0.8,
      >> "%OUT%" echo           "tags": ["!THEME!"]
      >> "%OUT%" echo         }
    )

    >> "%OUT%" echo       ]
    >> "%OUT%" echo     }
  )
)

if "%FIRST_THEME%"=="1" (
  >> "%OUT%" echo   "categories": []
) else (
  >> "%OUT%" echo   ]
)

>> "%OUT%" echo }

echo.
echo OK: gerado %OUT% (recursivo) a partir de .\audio\*
echo Agora faca Commit + Push no GitHub Desktop.
echo.
pause
