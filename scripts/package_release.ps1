$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = $packageJson.version
$releaseRoot = Join-Path $root "releases"
$releaseDir = Join-Path $releaseRoot "YDGlassManager_V$version"

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

$repoDir = Join-Path $root "Repo"
if (Test-Path $repoDir) {
  $repoDist = Join-Path $repoDir "dist"
  if (Test-Path $repoDist) {
    Remove-Item -LiteralPath $repoDist -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $root "dist") -Destination $repoDist -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination (Join-Path $repoDir "index.html") -Force
  Write-Host "Repo web assets updated: $repoDist"
}

Copy-Item -LiteralPath (Join-Path $root "supabase") -Destination $releaseDir -Recurse -Force
$supabaseTemp = Join-Path $releaseDir "supabase\.temp"
if (Test-Path $supabaseTemp) {
  Remove-Item -LiteralPath $supabaseTemp -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $root "icons") -Destination $releaseDir -Recurse -Force

$installer = Get-ChildItem -Path (Join-Path $root "dist-installer") -Filter "YD-Glass-Manager-Setup-*.exe" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($installer) {
  Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir $installer.Name) -Force
} else {
  Write-Host "No Windows installer found yet. Run npm run dist:win first to include it."
}

$apkGroups = @(
  @{
    Label = "full"
    Names = @(
      "YDGlassManager-Full-$version.apk",
      "YDGlassManager-Full-Android-debug-v$version.apk"
    )
  },
  @{
    Label = "status"
    Names = @(
      "YDGlassManager-OrderStatus-$version.apk",
      "YDGlassManager-OrderStatus-Android-debug-v$version.apk"
    )
  }
)
$apks = @()
$usingDebugAndroid = $false
foreach ($group in $apkGroups) {
  $apk = $null
  foreach ($name in $group.Names) {
    $candidate = Get-Item -LiteralPath (Join-Path $root "dist-android\$name") -ErrorAction SilentlyContinue
    if ($candidate) {
      $apk = $candidate
      break
    }
  }
  if (!$apk) {
    throw "Expected Android $($group.Label) APK is missing. Run npm run android:release first; it will use debug APKs when release signing is unavailable."
  }
  if ($apk.Name -match "debug") {
    $usingDebugAndroid = $true
  }
  $apks += $apk
}
foreach ($apk in $apks) {
  Copy-Item -LiteralPath $apk.FullName -Destination (Join-Path $releaseDir $apk.Name) -Force
}
if ($usingDebugAndroid) {
  Write-Warning "Release folder includes debug-signed Android APKs because production Android signing is unavailable."
}

$zipPath = Join-Path $releaseRoot "YDGlassManager_V$version`_release.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force

Write-Host "Release folder: $releaseDir"
Write-Host "Release archive: $zipPath"
