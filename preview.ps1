#!/usr/bin/env pwsh
# AKARI Video Preview Server — 起動スクリプト (Windows PowerShell)

param(
  [string]$Project = $env:AKARI_PROJECT,
  [int]$Port = ($env:AKARI_PORT -as [int]),
  [switch]$Open,
  [switch]$Help
)

if (-not $Project) { $Project = "." }
if (-not $Port) { $Port = 4567 }

$ErrorActionPreference = "Stop"

if ($Help) {
  Write-Host "AKARI Video Preview Server" -ForegroundColor Green
  Write-Host ""
  Write-Host "Usage: preview.ps1 [[-Project] <path>] [[-Port] <int>] [-Open] [-Help]"
  Write-Host ""
  Write-Host "Bare number as first argument is treated as port (project=current dir)."
  Write-Host ""
  Write-Host "Options:"
  Write-Host "  -Project <path>   Project directory (default: ., env: AKARI_PROJECT)"
  Write-Host "  -Port <int>       Port number (default: 4567, env: AKARI_PORT)"
  Write-Host "  -Open             Open browser automatically"
  Write-Host "  -Help             Show this help"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  .\preview.ps1                    # current dir, port 4567"
  Write-Host "  .\preview.ps1 3000               # current dir, port 3000"
  Write-Host "  .\preview.ps1 .\test-project     # port 4567"
  Write-Host "  .\preview.ps1 .\test-project 3000"
  exit 0
}

# If Project looks like a bare number, treat it as port instead
if ($Project -match '^\d+$') {
  $Port = [int]$Project
  $Project = "."
}

# Resolve absolute path
$Project = Resolve-Path $Project -ErrorAction Stop

# Validate project
if (-not (Test-Path "$Project\edit.json")) {
  Write-Host "[ERR] Not an AKARI Video project: $Project\edit.json not found" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Point to an existing project:"
  Write-Host "    .\preview.ps1 C:\path\to\project"
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

$ScriptDir = Split-Path -Parent $PSCommandPath

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  AKARI Video Preview Server" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Project: $Project"
Write-Host "  URL:     http://localhost:$Port"
Write-Host ""
Write-Host "  Ctrl+C to stop"
Write-Host ""

$serverJob = Start-Job -ScriptBlock {
  param($ScriptDir, $Project, $Port)
  node "$ScriptDir/packages/preview-server/src/server.mjs" "$Project" "--port" "$Port"
} -ArgumentList $ScriptDir, $Project, $Port

if ($Open) {
  Start-Sleep 2
  Start-Process "http://localhost:$Port"
}

try {
  Receive-Job $serverJob -Wait -ErrorAction Continue
} finally {
  Stop-Job $serverJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob -ErrorAction SilentlyContinue
}
