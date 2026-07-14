<#
.SYNOPSIS
  Build, package, tag and publish a new Synapse AI extension release to GitHub.

.DESCRIPTION
  Automates the full release flow:
    1. Reads the version from apps/extension/manifest.json
    2. Builds the extension with the Supabase proxy URL baked in (no secret shipped)
    3. Zips dist/ into synapse-ai-v<version>.zip
    4. Creates & pushes a git tag v<version>
    5. Creates a GitHub Release and uploads the zip as a downloadable asset

  Your website's "download latest" button can keep reading:
    https://api.github.com/repos/lx-obsidian-labs/synapse-social/releases/latest

.PARAMETER Token
  A GitHub Personal Access Token with 'repo' scope. Falls back to the
  GITHUB_TOKEN environment variable if omitted.

.PARAMETER ProxyUrl
  The Supabase Edge Function proxy URL to bake into the build.

.PARAMETER Notes
  Optional release notes (markdown). A sensible default is used otherwise.

.EXAMPLE
  ./scripts/release.ps1 -Token ghp_xxx
#>
[CmdletBinding()]
param(
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$ProxyUrl = "https://fvfrbxyrlonmucyvzppk.supabase.co/functions/v1/nvidia-proxy",
  [string]$Notes,
  [string]$Owner = "lx-obsidian-labs",
  [string]$Repo  = "synapse-social"
)

$ErrorActionPreference = "Stop"

# --- Resolve paths (script lives in <root>/scripts) ---
$root = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $root "apps\extension"
$manifestPath = Join-Path $extDir "manifest.json"
$distDir = Join-Path $extDir "dist"

if (-not $Token) {
  throw "No GitHub token. Pass -Token ghp_... or set `$env:GITHUB_TOKEN."
}
if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}

# --- 1. Read version ---
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"
$zipName = "synapse-ai-v$version.zip"
$zipPath = Join-Path $extDir $zipName
Write-Host "==> Releasing Synapse AI $tag" -ForegroundColor Cyan

# --- Guard: tag must not already exist ---
$existing = git tag --list $tag
if ($existing) {
  throw "Tag $tag already exists. Bump 'version' in manifest.json first."
}

# --- 2. Build (proxy baked in, no NVIDIA key shipped) ---
Write-Host "==> Building extension..." -ForegroundColor Cyan
$env:SUPABASE_PROXY_URL = $ProxyUrl
Push-Location $extDir
try {
  node build.mjs
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
} finally {
  Pop-Location
}

# Safety: ensure no NVIDIA key leaked into the bundle
$bg = Get-Content (Join-Path $distDir "background.js") -Raw
if ($bg -match "nvapi-") {
  throw "ABORT: an NVIDIA key ('nvapi-') leaked into dist/background.js. Do not ship this build."
}
if (-not $bg.Contains("nvidia-proxy")) {
  Write-Warning "Proxy URL not found in build - the extension may not reach the AI service."
}

# --- 3. Zip ---
Write-Host "==> Packaging $zipName..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath }
Compress-Archive -Path (Join-Path $distDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
$zipKb = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "    $zipName ($zipKb KB)"

# --- 4. Tag & push ---
Write-Host "==> Tagging & pushing $tag..." -ForegroundColor Cyan
git tag -a $tag -m "Synapse AI $tag"
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "git push tag failed." }

# --- 5. Create GitHub release + upload asset ---
if (-not $Notes) {
  $Notes = "AI-powered browser automation extension.`n`n## Install`nDownload ``$zipName``, unzip, then load the folder at chrome://extensions (Developer mode -> Load unpacked). Works out of the box - no API key needed.`n`nSee apps/extension/INSTALL.md for details."
}

$headers = @{ Authorization = "token $Token"; "User-Agent" = "synapse-release"; Accept = "application/vnd.github+json" }
$relBody = @{ tag_name = $tag; name = "Synapse AI $version"; body = $Notes; draft = $false; prerelease = $false } | ConvertTo-Json

Write-Host "==> Creating GitHub release..." -ForegroundColor Cyan
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases" -Method Post -Headers $headers -Body $relBody -ContentType "application/json"

Write-Host "==> Uploading $zipName..." -ForegroundColor Cyan
$uploadUri = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($rel.id)/assets?name=$zipName"
$asset = Invoke-RestMethod -Uri $uploadUri -Method Post -Headers @{ Authorization = "token $Token"; "User-Agent" = "synapse-release" } -InFile $zipPath -ContentType "application/zip"

Write-Host ""
Write-Host "Release published!" -ForegroundColor Green
Write-Host "  Page:     $($rel.html_url)"
Write-Host "  Download: $($asset.browser_download_url)"
Write-Host "  Latest:   https://api.github.com/repos/$Owner/$Repo/releases/latest"
