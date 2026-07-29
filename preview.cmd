@echo off
:: AKARI Video Preview Server — 起動スクリプト (Windows CMD)
:: Usage: preview.cmd [project-path] [port]

setlocal enabledelayedexpansion

set PROJECT=%AKARI_PROJECT%
if not defined PROJECT set PROJECT=.
set PORT=%AKARI_PORT%
if not defined PORT set PORT=4567
set OPEN_BROWSER=false

:parse
if "%~1"=="" goto :endparse
if "%~1"=="-h" goto :help
if "%~1"=="--help" goto :help
if "%~1"=="-p" set PORT=%~2& shift & shift & goto :parse
if "%~1"=="--port" set PORT=%~2& shift & shift & goto :parse
if "%~1"=="-o" set OPEN_BROWSER=true& shift & goto :parse
if "%~1"=="--open" set OPEN_BROWSER=true& shift & goto :parse
:: Bare number = port
set "ISNUM=1"
for /f "delims=0123456789" %%a in ("%~1") do set "ISNUM=0"
if "%ISNUM%"=="1" set PORT=%~1& shift & goto :parse
:: Otherwise = project path (only first one)
if "%PROJECT%"=="." set PROJECT=%~1& shift & goto :parse
echo More than one project path specified >&2
exit /b 1

:endparse

:: Validate project
if not exist "%PROJECT%\edit.json" (
    echo [ERR] Not an AKARI Video project: %PROJECT%\edit.json not found
    echo.
    echo   Point to an existing project:
    echo     preview.cmd C:\path\to\project
    echo.
    pause
    exit /b 1
)

:: Resolve absolute path
for %%i in ("%PROJECT%") do set PROJECT=%%~fi

:: Resolve script directory (same dir as this .cmd)
set SCRIPT_DIR=%~dp0
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   AKARI Video Preview Server
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo   Project: %PROJECT%
echo   URL:     http://localhost:%PORT%
echo.
echo   Ctrl+C to stop
echo.

start "AKARI Preview" /B node "%SCRIPT_DIR%\packages\preview-server\src\server.mjs" "%PROJECT%" --port %PORT%

if "%OPEN_BROWSER%"=="true" (
    timeout /t 2 /nobreak >nul
    start http://localhost:%PORT%
)

:: Keep window open
pause
exit /b 0

:help
echo AKARI Video Preview Server
echo.
echo Usage: preview.cmd [options] [project-path] [port]
echo.
echo Options:
echo   -p, --port ^<port^>    Port number (default: 4567, env: AKARI_PORT)
echo   -o, --open           Open browser automatically
echo   -h, --help           Show this help
echo.
echo Port can also be given as a bare number (the last positional arg).
echo.
echo Examples:
echo   preview.cmd                          current dir, port 4567
echo   preview.cmd 3000                     current dir, port 3000
echo   preview.cmd test-project 3000        project + port
echo   preview.cmd C:\project -o            open browser
exit /b 0
