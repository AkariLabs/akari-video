@echo off
:: AKARI Video Installer for Windows CMD
:: Usage:
::   curl -fsSL https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.cmd -o install.cmd && install.cmd

echo.
echo     _             _ _             _   _     _
echo    / \   _ __  __^| ^| ^|_ __ __ _  ^| ^| ^| ^|___^| ^|_
echo   / _ \ ^| '__^|/ _` ^| ^| '__/ _` ^| ^| ^| ^| / _ \ __^|
echo  / ___ \^| ^|  ^| (^| ^| ^| ^| ^| (^| ^| ^| ^|_^| ^|  __/ ^|_
echo /_/   \_\_^|   \__,_^|_^|_^|  \__,_^|  \___/ \___^|\__^|
echo.
echo AI-powered video editor — installer
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [--] Node.js not found
    echo     Install from: https://nodejs.org/
    echo     Then re-run this script.
    pause
    exit /b 1
)
for /f "tokens=1 delims=." %%a in ('node --version 2^>nul') do set NODE_VER=%%a
set NODE_VER=%NODE_VER:v=%
if %NODE_VER% lss 20 (
    echo [!!] Node.js v%NODE_VER% — v20+ required
    pause
    exit /b 1
)
echo [OK] Node.js
call npm --version >nul 2>&1
if %ERRORLEVEL% equ 0 echo [OK] npm

:: Check AI Agent — opencode (primary)
set AGENT_FOUND=0
where opencode >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] opencode (primary)
    set AGENT_FOUND=1
)
where claude >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Claude Code (secondary)
    set AGENT_FOUND=1
)
if %AGENT_FOUND% equ 0 (
    echo [--] No AI agent found
    echo.
    echo   opencode (free, recommended): https://opencode.ai
    echo   Claude Code (paid):           https://docs.anthropic.com/en/docs/claude-code/overview
    echo.
)

:: Check ffmpeg
where ffmpeg >nul 2>&1
if %ERRORLEVEL% equ 0 (echo [OK] ffmpeg) else (echo [--] ffmpeg not found ^[optional^])

echo.

:: Clone or update
set INSTALL_DIR=%USERPROFILE%\akari-video
if exist "%INSTALL_DIR%\.git" (
    echo Pulling latest...
    cd /d "%INSTALL_DIR%"
    git pull --ff-only
) else if exist "%INSTALL_DIR%" (
    echo Directory exists: %INSTALL_DIR% — skipping clone.
) else (
    echo Cloning kuwa2005/akari-video...
    git clone https://github.com/kuwa2005/akari-video.git "%INSTALL_DIR%"
)

echo.
echo Installing npm dependencies...
cd /d "%INSTALL_DIR%"
call npm install --no-audit --no-fund

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   Installation complete!
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo   cd %INSTALL_DIR%
echo   node packages\akari-launcher\bin\akari.mjs --opencode
echo.
echo Docs: https://github.com/kuwa2005/akari-video/blob/main/docs/getting-started.ja.md
echo.
pause
