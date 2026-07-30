@echo off
setlocal enabledelayedexpansion
:: AKARI Video Installer for Windows CMD
:: Usage:
::   curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.cmd -o install.cmd && install.cmd

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
    echo Fetching updates...
    cd /d "%INSTALL_DIR%"
    git fetch --tags --force origin
) else if exist "%INSTALL_DIR%" (
    echo Directory exists: %INSTALL_DIR% — skipping clone.
) else (
    echo Cloning AkariLabs/akari-video...
    git clone https://github.com/AkariLabs/akari-video.git "%INSTALL_DIR%"
)

:: 配布はリリースタグ固定（既定で main を配らない。AKARI_REF 環境変数で上書き可）
if exist "%INSTALL_DIR%\.git" (
    cd /d "%INSTALL_DIR%"
    set "TARGET_REF=%AKARI_REF%"
    if not defined TARGET_REF (
        for /f "delims=" %%t in ('git tag -l "v[0-9]*" --sort=-v:refname') do if not defined TARGET_REF set "TARGET_REF=%%t"
    )
    if not defined TARGET_REF (
        echo   No release tag found -- falling back to origin/main.
        set "TARGET_REF=origin/main"
    )
    git checkout --force --detach !TARGET_REF!
)

echo.
echo Installing npm dependencies...
cd /d "%INSTALL_DIR%"
call npm install --no-audit --no-fund

:: ─── PATH 登録 ───
set "PATH=%INSTALL_DIR%;%PATH%"
for /f "skip=2 tokens=3*" %%a in ('reg query HKCU\Environment /v PATH 2^>nul') do set USER_PATH=%%a%%b
echo "%USER_PATH%" | findstr /i "%INSTALL_DIR%" >nul 2>&1
if errorlevel 1 (
    setx PATH "%INSTALL_DIR%;%USER_PATH%" >nul 2>&1
    echo [OK] PATH を登録しました（次回以降の端末で有効）
)

:: ─── Detect primary AI agent for Quick Start ───
set AGENT_NAME=AI エージェント
where claude >nul 2>nul
if not errorlevel 1 set AGENT_NAME=Claude Code
if "%AGENT_NAME%"=="AI エージェント" (
    where opencode >nul 2>nul
    if not errorlevel 1 set AGENT_NAME=opencode
)

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   Installation complete!
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo   0. ヘルプを表示（サブコマンド一覧）
echo      akari.cmd --help
echo.
echo   1. 作業用ディレクトリを作って移動
echo      mkdir C:\Users\%USERNAME%\my-first-video ^&^& cd /d C:\Users\%USERNAME%\my-first-video
echo.
echo   2. %AGENT_NAME% を起動（プロジェクトが自動生成される）
echo      akari.cmd
echo.
echo   3. 別の端末でプレビューサーバー
echo      akari.cmd --preview
echo.
echo Docs: https://github.com/AkariLabs/akari-video/blob/main/docs/getting-started.ja.md
echo.
pause
