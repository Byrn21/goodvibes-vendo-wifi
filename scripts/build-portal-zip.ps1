# ================================================================
# build-portal-zip.ps1 - Rebuilds portal-upload.zip from repo files
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\build-portal-zip.ps1
# Called automatically by the pre-commit hook (scripts/hooks/pre-commit).
#
# Packages the portal frontend (html, assets, config) into
# portal-upload.zip at the repo root, ready to upload to the
# Omada Controller (Settings -> Portal -> upload package).
# ================================================================

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$zipPath    = Join-Path $repoRoot 'portal-upload.zip'
$stagingDir = Join-Path $env:TEMP 'portal-upload-staging'

# Files packaged at the zip root (paths relative to repo root).
# Forward slashes - the Omada controller serves these as web paths.
$files = @(
  'index.html',
  'status.html',
  'success.html',
  'error.html',
  'assets/portal.js',
  'assets/carousel.js',
  'assets/style.css',
  'config/config.js'
)

# Logo + payment images referenced by the portal pages.
$imageFiles = Get-ChildItem -Path (Join-Path $repoRoot 'assets/images') -File |
  ForEach-Object { 'assets/images/' + $_.Name }

$allFiles = $files + $imageFiles

# --- Verify every required file exists before touching the zip ---
$missing = @()
foreach ($rel in $allFiles) {
  if (-not (Test-Path (Join-Path $repoRoot ($rel -replace '/', '\')))) { $missing += $rel }
}
if ($missing.Count -gt 0) {
  Write-Error "build-portal-zip: missing required files: $($missing -join ', ')"
  exit 1
}

# --- Clean staging area ---
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $stagingDir | Out-Null

# --- Stage files ---
foreach ($rel in $allFiles) {
  $src = Join-Path $repoRoot ($rel -replace '/', '\')
  $dst = Join-Path $stagingDir ($rel -replace '/', '\')
  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item $src $dst -Force
}

# --- Remove old zip ---
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# --- Build zip with forward-slash entry names (Omada-compatible) ---
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($rel in $allFiles) {
    $fileOnDisk = Join-Path $stagingDir ($rel -replace '/', '\')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $fileOnDisk, $rel,
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
}
finally {
  $zip.Dispose()
}

# --- Cleanup staging ---
Remove-Item $stagingDir -Recurse -Force

$entryCount = $allFiles.Count
$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "build-portal-zip: OK - portal-upload.zip rebuilt ($entryCount files, $sizeKB KB)"
exit 0
