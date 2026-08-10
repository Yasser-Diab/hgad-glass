$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $root "android"
$outDir = Join-Path $root "dist-android"
$version = (Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json).version

function Invoke-NpmScript {
  param([Parameter(Mandatory = $true)][string]$ScriptName)
  Push-Location $root
  try {
    & npm run $ScriptName
    if ($LASTEXITCODE -ne 0) {
      throw "npm run $ScriptName failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-CapCopy {
  Push-Location $root
  try {
    & npx cap copy android
    if ($LASTEXITCODE -ne 0) {
      throw "Capacitor copy failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-Gradle {
  param([Parameter(Mandatory = $true)][string]$TaskName)
  Push-Location $androidDir
  try {
    if (!(Test-Path ".\gradlew.bat")) {
      throw "gradlew.bat was not found in android directory."
    }
    & .\gradlew.bat $TaskName
    if ($LASTEXITCODE -ne 0) {
      throw "Gradle task $TaskName failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Copy-DebugApk {
  param(
    [Parameter(Mandatory = $true)][string]$Flavor,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $apkPath = Join-Path $androidDir "app\build\outputs\apk\$Flavor\debug\app-$Flavor-debug.apk"
  if (!(Test-Path $apkPath)) {
    throw "No debug APK was produced at $apkPath."
  }
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $destination = Join-Path $outDir $Name
  Copy-Item -LiteralPath $apkPath -Destination $destination -Force
  Write-Host "Debug APK: $destination"
}

if (!(Test-Path $androidDir)) {
  Write-Host "Android project is missing. Run: npm run android:add"
  exit 1
}

Invoke-Gradle "assembleFullDebug"
Copy-DebugApk "full" "YDGlassManager-Full-Android-debug-v$version.apk"

Invoke-NpmScript "build:status"
Push-Location $root
try {
  & powershell -ExecutionPolicy Bypass -File "scripts/sync_android_status_assets.ps1"
  if ($LASTEXITCODE -ne 0) {
    throw "Status asset sync failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
Invoke-Gradle "assembleStatusDebug"
Copy-DebugApk "status" "YDGlassManager-OrderStatus-Android-debug-v$version.apk"

# Leave the Android project on the full application bundle after producing the
# status-only debug APK, matching the release script behavior.
Invoke-NpmScript "build:web"
Invoke-CapCopy
