$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$webDist = Join-Path $root "dist"
$androidAssetsParent = Resolve-Path (Join-Path $root "android\app\src\main\assets")
$androidAssets = Join-Path $androidAssetsParent "public"

if (!(Test-Path $webDist)) {
  throw "Web bundle is missing. Run: npm run build:web"
}

$resolvedTarget = [System.IO.Path]::GetFullPath($androidAssets)
$resolvedParent = [System.IO.Path]::GetFullPath($androidAssetsParent)
if (!$resolvedTarget.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use unexpected Android asset path: $resolvedTarget"
}

if (!(Test-Path $androidAssets)) {
  Push-Location $root
  try {
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) {
      throw "Capacitor initial Android sync failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

# This workspace is hosted on a volume where Capacitor cannot reliably remove
# an existing generated directory. Overlaying the hashed web bundle is enough:
# index.html selects the active flavor and stale hashed assets are unreachable.
Copy-Item -Path (Join-Path $webDist "*") -Destination $androidAssets -Recurse -Force
Write-Host "Android full assets synced: $androidAssets"
