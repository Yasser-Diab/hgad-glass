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
    & .\gradlew.bat assembleRelease
  } else {
    throw "gradlew.bat was not found in android directory."
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Android release build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$outDir = Join-Path $root "dist-android"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$version = (Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json).version
$apk = Get-ChildItem -Path (Join-Path $androidDir "app\build\outputs\apk\release") -Filter "*.apk" -Recurse | Select-Object -First 1
if ($apk) {
  Copy-Item -LiteralPath $apk.FullName -Destination (Join-Path $outDir "GlassOrders-Android-v$version.apk") -Force
  Write-Host "APK: $(Join-Path $outDir "GlassOrders-Android-v$version.apk")"
} else {
  throw "No release APK was produced."
}
