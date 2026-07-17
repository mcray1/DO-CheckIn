# Build the DO Check-In frontend and package it for cPanel upload.
#
# Produces pod-deploy.zip whose CONTENTS (index.html, assets/, ...) sit at the
# archive root, so extracting it inside public_html/pod/ lands index.html at
# public_html/pod/index.html — matching the Vite base '/pod/'.
#
# Usage:  npm run deploy:zip      (preferred)
#     or: pwsh -NoProfile -File ./deploy-build.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Building production bundle..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

$dist = Join-Path $PSScriptRoot "dist"
$zip  = Join-Path $PSScriptRoot "pod-deploy.zip"

if (-not (Test-Path (Join-Path $dist "index.html"))) {
    throw "dist/index.html not found - build did not produce output as expected."
}
if (Test-Path $zip) { Remove-Item $zip -Force }

Write-Host "==> Zipping dist/ contents..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -Force

$size = "{0:N0} KB" -f ((Get-Item $zip).Length / 1KB)
Write-Host ""
Write-Host "Done -> pod-deploy.zip ($size)" -ForegroundColor Green
Write-Host "Next: cPanel File Manager -> public_html/pod/ -> Upload pod-deploy.zip -> Extract -> delete the zip." -ForegroundColor Green
