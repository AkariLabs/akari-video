#Requires -Version 5.1
<#
.SYNOPSIS
    AKARI Video Installer for Windows

.DESCRIPTION
    Checks and auto-installs prerequisites (Node.js + npm, Claude Code/opencode, ffmpeg),
    clones the repository, and installs npm dependencies.

.EXAMPLE
    irm https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -InstallDir "D:\akari-video"
#>
param(
    [string]$InstallDir = "$env:USERPROFILE\akari-video",
    [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"

# ─── Helpers ───

function Write-Info  { param([string]$Msg) Write-Host $Msg -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host $Msg -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host $Msg -ForegroundColor Red }
function Has-Cmd     { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Get-NodeMajor {
    try { return [int]((node --version 2>$null) -replace '^v','' -split '\.' | Select-Object -First 1) }
    catch { return 0 }
}

# ─── Banner ───

Write-Host ""
Write-Host "    _             _ _             _   _     _  " -ForegroundColor DarkGray
Write-Host "   / \   _ __  __| | |_ __ __ _  | | | |___| |_" -ForegroundColor DarkGray
Write-Host "  / _ \ | '__|/ _\` | | '__/ _\` | | | | / _ \ __|" -ForegroundColor DarkGray
Write-Host " / ___ \| |  | (_| | | | | (_| | | |_| |  __/ |_ " -ForegroundColor DarkGray
Write-Host "/_/   \_\_|   \__,_|_|_|  \__,_|  \___/ \___|\__|" -ForegroundColor DarkGray
Write-Host ""
Write-Host "AI-powered video editor — installer" -ForegroundColor DarkGray
Write-Host ""

# ═══════════════════════════════════════════════
#  1. Node.js + npm
# ═══════════════════════════════════════════════

Write-Host "Checking dependencies..."
Write-Host ""

$nodeOk = $false

if (Has-Cmd node) {
    $major = Get-NodeMajor
    if ($major -ge 20) {
        Write-Info "  [OK] Node.js v$(node --version 2>$null)"
        $npmVer = npm --version 2>$null
        if ($npmVer) { Write-Info "  [OK] npm     v$npmVer" }
        $nodeOk = $true
    } else {
        Write-Warn "  [!!] Node.js v$(node --version 2>$null) — v20+ required"
    }
} else {
    Write-Err "  [--] Node.js not found"
}

if (-not $nodeOk -and -not $SkipDeps) {
    Write-Host ""
    Write-Info "Installing Node.js v20 LTS..."

    if (Has-Cmd winget) {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    } elseif (Has-Cmd choco) {
        choco install nodejs-lts -y
    } elseif (Has-Cmd scoop) {
        scoop install nodejs-lts
    } else {
        Write-Warn "Install Node.js manually: https://nodejs.org/"
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    if (Has-Cmd node) {
        Write-Info "  Node.js $(node --version) installed"
        $npmVer = npm --version 2>$null
        if ($npmVer) { Write-Info "  npm     v$npmVer" }
        $nodeOk = $true
    } else {
        Write-Err "Node.js install failed. Install manually: https://nodejs.org/"
    }
}

# ═══════════════════════════════════════════════
#  2. AI Agent (Claude Code / opencode)
# ═══════════════════════════════════════════════

$agentOk = $false
if (Has-Cmd claude) {
    Write-Info "  [OK] Claude Code"
    $agentOk = $true
}
if (Has-Cmd opencode) {
    Write-Info "  [OK] opencode"
    $agentOk = $true
}
if (-not $agentOk) {
    Write-Err "  [--] No AI agent found"
}

if (-not $agentOk -and -not $SkipDeps) {
    Write-Host ""
    Write-Warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Warn "  AI agent is required. Install one of:"
    Write-Warn ""
    Write-Warn "  Claude Code (paid, recommended):"
    Write-Warn "    https://docs.anthropic.com/en/docs/claude-code/overview"
    Write-Warn ""
    Write-Warn "  opencode (free):"
    Write-Warn "    https://opencode.ai"
    Write-Warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Host ""
}

# ═══════════════════════════════════════════════
#  3. ffmpeg
# ═══════════════════════════════════════════════

$ffmpegOk = $false
if (Has-Cmd ffmpeg) {
    Write-Info "  [OK] ffmpeg"
    $ffmpegOk = $true
} else {
    Write-Warn "  [--] ffmpeg not found (optional, recommended)"
}

if (-not $ffmpegOk -and -not $SkipDeps -and $nodeOk) {
    $answer = Read-Host "Install ffmpeg now? [Y/n]"
    if ($answer -ne 'n' -and $answer -ne 'N') {
        Write-Host ""
        Write-Info "Installing ffmpeg..."
        if (Has-Cmd winget) {
            winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
        } elseif (Has-Cmd choco) {
            choco install ffmpeg -y
        } elseif (Has-Cmd scoop) {
            scoop install ffmpeg
        } else {
            Write-Warn "Install ffmpeg manually: https://ffmpeg.org/download.html"
        }
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    }
}

# ═══════════════════════════════════════════════
#  Clone or update
# ═══════════════════════════════════════════════

Write-Host ""
if (Test-Path "$InstallDir\.git") {
    Write-Info "Repository exists at $InstallDir"
    Write-Info "Pulling latest..."
    Push-Location $InstallDir
    git pull --ff-only 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Could not pull. Using existing version." }
    Pop-Location
} elseif (Test-Path $InstallDir) {
    Write-Warn "Directory exists but is not a git repo: $InstallDir"
    Write-Warn "Skipping clone. Remove it first or choose a different path."
} else {
    Write-Info "Cloning kuwa2005/akari-video..."
    git clone "https://github.com/kuwa2005/akari-video.git" $InstallDir
}

# ═══════════════════════════════════════════════
#  npm install
# ═══════════════════════════════════════════════

Write-Host ""
Write-Info "Installing npm dependencies..."
Push-Location $InstallDir
npm install --no-audit --no-fund
Pop-Location

# ═══════════════════════════════════════════════
#  Done
# ═══════════════════════════════════════════════

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""

if (Has-Cmd claude) {
    Write-Host "  Quick start (Claude Code):"
    Write-Host ""
    Write-Host "    cd $InstallDir"
    Write-Host "    node packages/akari-launcher/bin/akari.mjs"
    Write-Host ""
}

if (Has-Cmd opencode) {
    Write-Host "  Quick start (opencode):"
    Write-Host ""
    Write-Host "    cd $InstallDir"
    Write-Host "    node packages/akari-launcher/bin/akari.mjs --opencode"
    Write-Host ""
}

if (-not (Has-Cmd claude) -and -not (Has-Cmd opencode)) {
    Write-Host "  AI agent not yet installed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  After installing Claude Code or opencode, run:"
    Write-Host ""
    Write-Host "    cd $InstallDir"
    Write-Host "    node packages/akari-launcher/bin/akari.mjs"
    Write-Host ""
}

Write-Host "Docs: https://github.com/kuwa2005/akari-video/blob/main/docs/getting-started.ja.md" -ForegroundColor DarkGray
Write-Host ""
