<#
.SYNOPSIS
  Build, test, package, commit and push Synapse AI in one command.

.DESCRIPTION
  1. Builds the extension with the Supabase proxy URL baked in
  2. Fails if an NVIDIA key leaked into the bundle
  3. Runs the deterministic extension test suite
  4. Packages dist/ into synapse-ai-v<version>.zip
  5. Commits every change and pushes to origin

  GitHub Actions (.github/workflows/extension-ci.yml) then re-builds and
  publishes the test prerelease on every push to main.

.PARAMETER Message
  Commit message. Defaults to a build stamp.

.PARAMETER Watch
  Keep running: re-ship whenever a source file changes.

.EXAMPLE
  ./scripts/ship.ps1 -Message "feat: built-in MCP presets"
#>
[CmdletBinding()]
param(
  [string]$Message,
  [string]$ProxyUrl = "https://fvfrbxyrlonmucyvzppk.supabase.co/functions/v1/nvidia-proxy",
  [string]$Branch = "main",
  [switch]$SkipTests,
  [switch]$Watch
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $root "apps\extension"
$manifestPath = Join-Path $extDir "manifest.json"
$distDir = Join-Path $extDir "dist"

if (-not (Test-Path $manifestPath)) { throw "manifest.json not found at $manifestPath" }
if (-not (Test-Path (Join-Path $root ".git"))) { throw "Not a git repository: $root" }

function Invoke-Ship {
  param([string]$CommitMessage)

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $version = $manifest.version
  $zipName = "synapse-ai-v$version.zip"
  $zipPath = Join-Path $extDir $zipName

  Write-Host "==> Building Synapse AI $version" -ForegroundColor Cyan
  $env:SUPABASE_PROXY_URL = $ProxyUrl
  Push-Location $extDir
  try {
    node build.mjs
    if ($LASTEXITCODE -ne 0) { throw "Build failed." }
  } finally { Pop-Location }

  $bg = Get-Content (Join-Path $distDir "background.js") -Raw
  if ($bg -match "nvapi-") { throw "ABORT: an NVIDIA key leaked into dist/background.js." }

  if (-not $SkipTests) {
    Write-Host "==> Running tests" -ForegroundColor Cyan
    Push-Location $extDir
    try {
      node --test tests/*.test.mjs
      if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
    } finally { Pop-Location }
  }

  Write-Host "==> Packaging $zipName" -ForegroundColor Cyan
  if (Test-Path $zipPath) { Remove-Item $zipPath }
  Compress-Archive -Path (Join-Path $distDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
  $zipKb = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
  Write-Host "    $zipName ($zipKb KB)"

  Write-Host "==> Committing and pushing" -ForegroundColor Cyan
  Push-Location $root
  try {
    git add -A
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
      Write-Host "    No changes to commit."
    } else {
      if (-not $CommitMessage) { $CommitMessage = "build: package v$version ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" }
      git commit -m $CommitMessage
      if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
    }
    git push origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "git push failed." }
  } finally { Pop-Location }

  Write-Host "Shipped v$version." -ForegroundColor Green
}

if ($Watch) {
  Write-Host "Watching apps/extension/src and manifest.json (Ctrl+C to stop)..." -ForegroundColor Yellow
  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = Join-Path $extDir "src"
  $watcher.IncludeSubdirectories = $true
  $watcher.Filter = "*.*"
  $watcher.EnableRaisingEvents = $true
  $pending = $false
  $handler = { $script:pending = $true }
  Register-ObjectEvent $watcher Changed -Action $handler | Out-Null
  Register-ObjectEvent $watcher Created -Action $handler | Out-Null
  while ($true) {
    Start-Sleep -Seconds 2
    if ($script:pending) {
      $script:pending = $false
      try { Invoke-Ship -CommitMessage $Message } catch { Write-Host "Ship failed: $_" -ForegroundColor Red }
    }
  }
} else {
  Invoke-Ship -CommitMessage $Message
}
