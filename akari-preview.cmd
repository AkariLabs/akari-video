@echo off
:: AKARI Video Preview Server — 起動スクリプト (Windows CMD)
:: Usage: akari-preview.cmd [project-path] [port]

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

:: Find monorepo root (walk up from script dir)
set MONOREPO=%AKARI_MONOREPO%
if defined MONOREPO goto :found_monorepo
set MONOREPO=%~dp0
:walk_loop
if exist "%MONOREPO%packages\preview-server\src\server.mjs" goto :found_monorepo
set MONOREPO=%MONOREPO%..\
if exist "%MONOREPO%" goto :walk_loop
set MONOREPO=%~dp0
:found_monorepo
if "%MONOREPO:~-1%"=="\" set MONOREPO=%MONOREPO:~0,-1%

:: Resolve absolute project path
if not exist "%PROJECT%" mkdir "%PROJECT%"
for %%i in ("%PROJECT%") do set PROJECT=%%~fi

:: Auto-create project if edit.json missing
if not exist "%PROJECT%\edit.json" (
    echo [INFO] Project not initialized. Scaffolding from template...
    if not exist "%MONOREPO%\templates\project-default" (
        echo [ERR] Template not found at %MONOREPO%\templates\project-default
        pause
        exit /b 1
    )
    xcopy /E /I /Y "%MONOREPO%\templates\project-default" "%PROJECT%" >nul
    mkdir "%PROJECT%\.akari\cache" "%PROJECT%\.akari\diffs" "%PROJECT%\.akari\events" "%PROJECT%\.akari\reports" "%PROJECT%\.akari\sidecars" "%PROJECT%\.akari\work" 2>nul
    echo {"version":1,"status":"draft"} > "%PROJECT%\intake.json"
    echo {} > "%PROJECT%\edit.json"
    echo   Created: %PROJECT%
)

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

start "AKARI Preview" /B node "%MONOREPO%\packages\preview-server\src\server.mjs" "%PROJECT%" --port %PORT%

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
echo Usage: akari-preview.cmd [options] [project-path] [port]
echo.
echo Options:
echo   -p, --port ^<port^>    Port number (default: 4567, env: AKARI_PORT)
echo   -o, --open           Open browser automatically
echo   -h, --help           Show this help
echo.
echo Port can also be given as a bare number (the last positional arg).
echo.
echo Examples:
echo   akari-preview.cmd                          current dir, port 4567
echo   akari-preview.cmd 3000                     current dir, port 3000
echo   akari-preview.cmd test-project 3000        project + port
echo   akari-preview.cmd C:\project -o            open browser
exit /b 0
