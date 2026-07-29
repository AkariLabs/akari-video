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
set PPROJECT=%AKARI_PROJECT%
if not defined PPROJECT set PPROJECT=.
set PPORT=%AKARI_PORT%
if not defined PPORT set PPORT=4567
set POPEN=false

:parse_preview
if "%~1"=="" goto :end_parse_preview
if "%~1"=="-h" goto :help
if "%~1"=="--help" goto :help
if "%~1"=="-p" set PPORT=%~2& shift & shift & goto :parse_preview
if "%~1"=="--port" set PPORT=%~2& shift & shift & goto :parse_preview
if "%~1"=="-o" set POPEN=true& shift & goto :parse_preview
if "%~1"=="--open" set POPEN=true& shift & goto :parse_preview
set "ISNUM=1"
for /f "delims=0123456789" %%a in ("%~1") do set "ISNUM=0"
if "%ISNUM%"=="1" set PPORT=%~1& shift & goto :parse_preview
if "%PPROJECT%"=="." set PPROJECT=%~1& shift & goto :parse_preview
echo More than one project path specified >&2
exit /b 1

:end_parse_preview
if not exist "%PPROJECT%" mkdir "%PPROJECT%"
for %%i in ("%PPROJECT%") do set PPROJECT=%%~fi
if not exist "%PPROJECT%\edit.json" (
    echo [INFO] Project not initialized. Scaffolding from template...
    if not exist "%MONOREPO%\templates\project-default" (
        echo [ERR] Template not found
        pause
        exit /b 1
    )
    xcopy /E /I /Y "%MONOREPO%\templates\project-default" "%PPROJECT%" >nul
    mkdir "%PPROJECT%\.akari\cache" "%PPROJECT%\.akari\diffs" "%PPROJECT%\.akari\events" "%PPROJECT%\.akari\reports" "%PPROJECT%\.akari\sidecars" "%PPROJECT%\.akari\work" 2>nul
    echo {"version":1,"status":"draft"} > "%PPROJECT%\intake.json"
    echo {} > "%PPROJECT%\edit.json"
    echo   Created: %PPROJECT%
)
echo.
echo ^======================================================
echo   AKARI Video Preview Server
echo ^======================================================
echo.
echo   Project: %PPROJECT%
echo   URL:     http://localhost:%PPORT%
echo.
echo   Ctrl+C to stop
echo.
start "AKARI Preview" /B node "%MONOREPO%\packages\preview-server\src\server.mjs" "%PPROJECT%" --port %PPORT%
if "%POPEN%"=="true" (
    timeout /t 2 /nobreak >nul
    start http://localhost:%PPORT%
)
pause
exit /b 0

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
