$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = $packageJson.version
$releaseRoot = Join-Path $root "releases"
$releaseDir = Join-Path $releaseRoot "GlassOrders_V$version"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

& npm run build:web
if ($LASTEXITCODE -ne 0) { throw "Web build failed." }

$webDir = Join-Path $releaseDir "web"
New-Item -ItemType Directory -Force -Path $webDir | Out-Null
Copy-Item -LiteralPath (Join-Path $root "dist") -Destination $webDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "supabase") -Destination $releaseDir -Recurse -Force
$supabaseTemp = Join-Path $releaseDir "supabase\.temp"
if (Test-Path $supabaseTemp) {
  Remove-Item -LiteralPath $supabaseTemp -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $root "icons") -Destination $releaseDir -Recurse -Force

$installer = Get-ChildItem -Path (Join-Path $root "dist-installer") -Filter "GlassOrders-Setup-*.exe" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($installer) {
  Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir $installer.Name) -Force
} else {
  Write-Host "No Windows installer found yet. Run npm run dist:win first to include it."
}

$apk = Get-ChildItem -Path (Join-Path $root "dist-android") -Filter "GlassOrders-Android-v$version*.apk" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($apk) {
  Copy-Item -LiteralPath $apk.FullName -Destination (Join-Path $releaseDir "GlassOrders-Android-v$version.apk") -Force
} else {
  Write-Host "No Android APK found yet. Run npm run android:release first to include it."
}

$zipPath = Join-Path $releaseRoot "GlassOrders_V$version`_release.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force

Write-Host "Release folder: $releaseDir"
Write-Host "Release archive: $zipPath"
