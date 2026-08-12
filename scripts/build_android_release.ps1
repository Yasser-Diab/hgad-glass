$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidDir = Join-Path $root "android"
$assetsParent = Resolve-Path (Join-Path $androidDir "app\src\main\assets")
$publicAssets = Join-Path $assetsParent "public"
$outDir = Join-Path $root "dist-android"
$version = (Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json).version

function Assert-WorkspacePath {
  param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $targetPath = [System.IO.Path]::GetFullPath($Target)
  $parentPath = [System.IO.Path]::GetFullPath($Parent)
  if (!$targetPath.StartsWith($parentPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside expected directory: $targetPath"
  }
}

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

function Copy-Apk {
  param(
    [Parameter(Mandatory = $true)][string]$Flavor,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $apkDir = Join-Path $androidDir "app\build\outputs\apk\$Flavor\release"
  $apk = Get-ChildItem -Path $apkDir -Filter "*.apk" -Recurse |
    Where-Object { $_.Name -notmatch "unsigned" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (!$apk) {
    throw "No signed $Flavor release APK was produced in $apkDir."
  }
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $destination = Join-Path $outDir $Name
  Copy-Item -LiteralPath $apk.FullName -Destination $destination -Force
  Write-Host "APK: $destination"
}

function Invoke-DebugBuildFallback {
  param([Parameter(Mandatory = $true)][string]$Reason)
  Write-Warning "$Reason"
  Write-Warning "Falling back to Android debug APK packaging. Production-signed Android release APKs will not be produced."
  Push-Location $root
  try {
    & npm run android:debug
    if ($LASTEXITCODE -ne 0) {
      throw "Android debug fallback failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
  exit 0
}

if (!(Test-Path $androidDir)) {
  throw "Android project is missing. Run: npm run android:add"
}

$signingVariables = @(
  "YD_RELEASE_STORE_FILE",
  "YD_RELEASE_STORE_PASSWORD",
  "YD_RELEASE_KEY_ALIAS",
  "YD_RELEASE_KEY_PASSWORD"
)
$missingSigningVariables = $signingVariables | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missingSigningVariables.Count -gt 0) {
  Invoke-DebugBuildFallback "Android release signing is not configured. Set these environment variables outside Git: $($missingSigningVariables -join ', ')"
}
$releaseStorePath = [Environment]::GetEnvironmentVariable("YD_RELEASE_STORE_FILE")
if (!(Test-Path -LiteralPath $releaseStorePath -PathType Leaf)) {
  Invoke-DebugBuildFallback "Android release keystore was not found at the path in YD_RELEASE_STORE_FILE."
}

Invoke-NpmScript "build:web"
Push-Location $root
try {
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) {
    throw "Capacitor sync failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
Invoke-Gradle "assembleFullRelease"
Copy-Apk "full" "YDGlassManager-Full-$version.apk"

Invoke-NpmScript "build:status"
Assert-WorkspacePath -Target $publicAssets -Parent $assetsParent
if (Test-Path $publicAssets) {
  Remove-Item -LiteralPath $publicAssets -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $publicAssets | Out-Null
Copy-Item -Path (Join-Path $root "dist-status\*") -Destination $publicAssets -Recurse -Force
Invoke-Gradle "assembleStatusRelease"
Copy-Apk "status" "YDGlassManager-OrderStatus-$version.apk"

# Leave the checked-out Android project with the full application assets after
# producing the status APK. The status flavor is built sequentially from its
# copied bundle above; normal development should reopen on the full app.
Invoke-NpmScript "build:web"
Push-Location $root
try {
  & npx cap copy android
  if ($LASTEXITCODE -ne 0) {
    throw "Capacitor copy failed while restoring full assets with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
