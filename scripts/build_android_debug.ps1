$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $root "android"

if (!(Test-Path $androidDir)) {
  Write-Host "Android project is missing. Run: npm run android:add"
  exit 1
}

Push-Location $androidDir
try {
  if (Test-Path ".\gradlew.bat") {
    & .\gradlew.bat assembleFullDebug
  } else {
    throw "gradlew.bat was not found in android directory."
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Android debug build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$outDir = Join-Path $root "dist-android"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$version = (Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json).version
$apkPath = Join-Path $androidDir "app\build\outputs\apk\full\debug\app-full-debug.apk"
if (!(Test-Path $apkPath)) {
  throw "No signed debug APK was produced at $apkPath."
}

$destination = Join-Path $outDir "YDGlassManager-Android-debug-v$version.apk"
Copy-Item -LiteralPath $apkPath -Destination $destination -Force
Write-Host "Debug APK: $destination"
