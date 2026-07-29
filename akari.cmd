@echo off
:: AKARI Video — メインエントリーポイント (Windows CMD)
setlocal enabledelayedexpansion

:: Find monorepo root (walk up from this script's dir)
set MONOREPO=%~dp0
:walk
if exist "%MONOREPO%packages\akari-launcher\bin\akari.mjs" goto :found
set MONOREPO=%MONOREPO%..\
if exist "%MONOREPO%" goto :walk
echo [ERR] Cannot find AKARI Video monorepo. >&2
exit /b 1
:found
if "%MONOREPO:~-1%"=="\" set MONOREPO=%MONOREPO:~0,-1%

if "%~1"=="--preview" shift & goto :preview
if "%~1"=="-pv" shift & goto :preview
if "%~1"=="-h" goto :help
if "%~1"=="--help" goto :help
if "%~1"=="-?" goto :help

node "%MONOREPO%\packages\akari-launcher\bin\akari.mjs" %*
exit /b %ERRORLEVEL%

:preview
call "%MONOREPO%\akari-preview.cmd" %*
exit /b %ERRORLEVEL%

:help
echo AKARI Video — AI-powered video editor
echo.
echo Usage: akari.cmd [command] [options...]
echo.
echo Commands:
echo   (no args)             Launch AI agent
echo   --preview, -pv        Start preview server
echo   -h, --help, -?        Show this help
echo.
echo Examples:
echo   akari.cmd                        AI agent launch
echo   akari.cmd --preview              Preview server
echo   akari.cmd --preview C:\project 3000
exit /b 0
