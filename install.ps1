#Requires -Version 5.1
<#
.SYNOPSIS
    AKARI Video Installer for Windows

.DESCRIPTION
    Checks and auto-installs prerequisites (Node.js + npm, opencode/Claude Code, ffmpeg),
    clones the repository, and installs npm dependencies.

.EXAMPLE
    irm https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.ps1 | iex
#>
param(
    [string]$InstallDir = "$env:USERPROFILE\akari-video",
    [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"

function Write-Info  { param([string]$Msg) Write-Host $Msg -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host $Msg -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host $Msg -ForegroundColor Red }
function Has-Cmd     { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Get-NodeMajor {
    try { return [int]((node --version 2>$null) -replace '^v','' -split '\.' | Select-Object -First 1) }
    catch { return 0 }
}

Write-Host ""
Write-Host "    _             _ _             _   _     _  " -ForegroundColor DarkGray
Write-Host "   / \   _ __  __| | |_ __ __ _  | | | |___| |_" -ForegroundColor DarkGray
Write-Host "  / _ \ | '__|/ _\` | | '__/ _\` | | | | / _ \ __|" -ForegroundColor DarkGray
Write-Host " / ___ \| |  | (_| | | | | (_| | | |_| |  __/ |_ " -ForegroundColor DarkGray
Write-Host "/_/   \_\_|   \__,_|_|_|  \__,_|  \___/ \___|\__|" -ForegroundColor DarkGray
Write-Host ""
Write-Host "AI-powered video editor — installer" -ForegroundColor DarkGray
Write-Host ""

# ═══ 1. Node.js + npm ═══

Write-Host "Checking dependencies..."
Write-Host ""

$nodeOk = $false
if (Has-Cmd node) {
    $major = Get-NodeMajor
    if ($major -ge 20) {
        Write-Info "  [OK] Node.js v$(node --version 2>$null)"
        $npmVer = npm --version 2>$null; if ($npmVer) { Write-Info "  [OK] npm     v$npmVer" }
        $nodeOk = $true
    } else { Write-Warn "  [!!] Node.js v$(node --version 2>$null) — v20+ required" }
} else { Write-Err "  [--] Node.js not found" }

if (-not $nodeOk -and -not $SkipDeps) {
    Write-Host ""; Write-Info "Installing Node.js v20 LTS..."
    if (Has-Cmd winget) { winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements }
    elseif (Has-Cmd choco) { choco install nodejs-lts -y }
    elseif (Has-Cmd scoop) { scoop install nodejs-lts }
    else { Write-Warn "Install Node.js manually: https://nodejs.org/" }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    if (Has-Cmd node) { Write-Info "  Node.js $(node --version) installed"; $nodeOk = $true }
    else { Write-Err "Install failed: https://nodejs.org/" }
}

# ═══ 2. AI Agent — opencode (primary) / Claude Code (secondary) ═══

$agentOk = $false
if (Has-Cmd opencode) { Write-Info "  [OK] opencode (primary)"; $agentOk = $true }
if (Has-Cmd claude)   { Write-Info "  [OK] Claude Code (secondary)"; $agentOk = $true }
if (-not $agentOk) { Write-Err "  [--] No AI agent found" }

if (-not $agentOk -and -not $SkipDeps) {
    Write-Host ""
    Write-Warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Warn "  AI agent is required. Install one of:"
    Write-Warn ""
    Write-Warn "  opencode (free, recommended):"
    Write-Warn "    https://opencode.ai"
    Write-Warn ""
    Write-Warn "  Claude Code (paid):"
    Write-Warn "    https://docs.anthropic.com/en/docs/claude-code/overview"
    Write-Warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Host ""
}

# ═══ 3. ffmpeg ═══

$ffmpegOk = $false
if (Has-Cmd ffmpeg) { Write-Info "  [OK] ffmpeg"; $ffmpegOk = $true }
else { Write-Warn "  [--] ffmpeg not found (optional, recommended)" }

if (-not $ffmpegOk -and -not $SkipDeps -and $nodeOk) {
    $answer = Read-Host "Install ffmpeg now? [Y/n]"
    if ($answer -ne 'n' -and $answer -ne 'N') {
        Write-Host ""; Write-Info "Installing ffmpeg..."
        if (Has-Cmd winget) { winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements }
        elseif (Has-Cmd choco) { choco install ffmpeg -y }
        elseif (Has-Cmd scoop) { scoop install ffmpeg }
        else { Write-Warn "Install ffmpeg manually: https://ffmpeg.org/download.html" }
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
}

# ═══ Clone or update ═══

Write-Host ""
if (-not (Has-Cmd git)) {
    Write-Err "git is required but not found. Install git and retry."
    exit 1
}
if (Test-Path "$InstallDir\.git") {
    Write-Info "Repository exists at $InstallDir — pulling latest..."
    Push-Location $InstallDir; git fetch origin; if (-not (git merge --ff-only origin/main 2>$null)) { Write-Warn "  Fast-forward failed — resetting to origin/main..."; git reset --hard origin/main }; Pop-Location
} elseif (Test-Path $InstallDir) {
    Write-Warn "Directory exists but is not a git repo: $InstallDir — skipping."
} else {
    Write-Info "Cloning AkariLabs/akari-video..."
    git clone "https://github.com/AkariLabs/akari-video.git" $InstallDir
}

# ═══ npm install ═══

Write-Host ""; Write-Info "Installing npm dependencies..."
Push-Location $InstallDir; npm install --no-audit --no-fund; Pop-Location

# ═══ PATH 登録 ═══
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$currentPath", "User")
    Write-Info "  PATH を登録しました（次回以降の端末で有効）"
}
# 現在のセッションにも反映
$env:PATH = "$InstallDir;$env:PATH"

# ═══ Done ═══

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
# Detect primary AI agent for Quick Start
$agentName = "AI エージェント"
if (Get-Command "claude" -ErrorAction SilentlyContinue) {
    $agentName = "Claude Code"
} elseif (Get-Command "opencode" -ErrorAction SilentlyContinue) {
    $agentName = "opencode"
}

Write-Host ""
Write-Host "  Quick start:"
Write-Host ""
Write-Host "    0. ヘルプを表示（サブコマンド一覧）"
Write-Host "       akari.cmd --help" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    1. 作業用ディレクトリを作って移動"
Write-Host "       mkdir ~/my-first-video; cd ~/my-first-video" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    2. $agentName を起動（プロジェクトが自動生成される）"
Write-Host "       akari.cmd" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    3. 別の端末でプレビューサーバー"
Write-Host "       akari.cmd --preview" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Docs: https://github.com/AkariLabs/akari-video/blob/main/docs/getting-started.ja.md" -ForegroundColor DarkGray
Write-Host ""
