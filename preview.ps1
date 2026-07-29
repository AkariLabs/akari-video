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

# Find monorepo root (walk up from script dir)
$MonoRepo = if ($env:AKARI_MONOREPO) { $env:AKARI_MONOREPO } else { Split-Path -Parent $PSCommandPath }
while (-not (Test-Path "$MonoRepo\packages\preview-server\src\server.mjs")) {
  $parent = Split-Path -Parent $MonoRepo
  if ($parent -eq $MonoRepo) { break }
  $MonoRepo = $parent
}
if (-not (Test-Path "$MonoRepo\packages\preview-server\src\server.mjs")) {
  Write-Host "[ERR] Cannot find AKARI Video monorepo. Set AKARI_MONOREPO or run from within the repo." -ForegroundColor Red
  Read-Host "Press Enter to exit"; exit 1
}

# Resolve absolute project path (create if needed)
if (-not (Test-Path $Project)) { New-Item -ItemType Directory -Path $Project -Force | Out-Null }
$Project = Resolve-Path $Project -ErrorAction Stop

# Auto-create project if edit.json missing
if (-not (Test-Path "$Project\edit.json")) {
  Write-Host "[INFO] Project not initialized. Scaffolding from template..." -ForegroundColor Yellow
  $template = "$MonoRepo\templates\project-default"
  if (-not (Test-Path $template)) { Write-Host "[ERR] Template not found: $template" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
  Copy-Item "$template\*" $Project -Recurse -Force
  Get-ChildItem $template -Directory | Where-Object { $_.Name -like '.*' } | ForEach-Object { Copy-Item $_.FullName $Project -Recurse -Force }
  @('.akari\cache','.akari\diffs','.akari\events','.akari\reports','.akari\sidecars','.akari\work') | ForEach-Object { New-Item -ItemType Directory -Path "$Project\$_" -Force | Out-Null }
  '{"version":1,"status":"draft"}' | Out-File "$Project\intake.json" -Encoding utf8
  '{}' | Out-File "$Project\edit.json" -Encoding utf8
  Write-Host "  Created: $Project" -ForegroundColor Green
}

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
  param($MonoRepo, $Project, $Port)
  node "$MonoRepo/packages/preview-server/src/server.mjs" "$Project" "--port" "$Port"
} -ArgumentList $MonoRepo, $Project, $Port

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
