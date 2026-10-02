@echo off
chcp 65001 >nul
setlocal
REM Jogatina - sincroniza sons entre uma pasta do PC e o site, sem git (usa sincronizar.py)
cd /d "%~dp0"
where python >nul 2>nul || (echo Instale o Python: https://www.python.org/downloads/ & pause & exit /b 1)
python -m pip install --quiet --disable-pip-version-check keyring

set "PASTA=%USERPROFILE%\Music\Sons Jogatina"
if not "%~1"=="" set "PASTA=%~1"

:menu
echo.
echo ===== Jogatina - sons =====
echo Pasta: %PASTA%
echo   (estrutura: Grupo\Tema\som.mp3  ex.: Ambientes\Taverna\Lareira.mp3)
echo.
echo  1) Ver diferencas entre a pasta e o site
echo  2) Enviar sons da pasta para o site
echo  3) Baixar sons do site para a pasta
echo  4) Importar sons do Freesound
echo  5) Guardar token do GitHub (uma vez)
echo  6) Guardar chave do Freesound (uma vez)
echo  0) Sair
choice /c 1234560 /n /m "Escolha: "
if errorlevel 7 exit /b 0
if errorlevel 6 (python sincronizar.py token --freesound & goto menu)
if errorlevel 5 (python sincronizar.py token & goto menu)
if errorlevel 4 goto freesound
if errorlevel 3 (python sincronizar.py baixar "%PASTA%" & goto menu)
if errorlevel 2 (python sincronizar.py enviar "%PASTA%" & goto menu)
if errorlevel 1 (python sincronizar.py status "%PASTA%" & goto menu)
goto menu

:freesound
set "BUSCA="
set "TEMA="
set /p BUSCA=O que buscar (ex.: owl hoot): 
set /p TEMA=Para qual tema (ex.: Criaturas/Coruja): 
python sincronizar.py freesound "%BUSCA%" --tema "%TEMA%"
goto menu
