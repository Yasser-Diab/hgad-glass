$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$statusDist = Join-Path $root "dist-status"
$androidAssetsParent = Resolve-Path (Join-Path $root "android\app\src\main\assets")
$androidAssets = Join-Path $androidAssetsParent "public"

if (!(Test-Path $statusDist)) {
  throw "Status bundle is missing. Run: npm run build:status"
}

$resolvedTarget = [System.IO.Path]::GetFullPath($androidAssets)
$resolvedParent = [System.IO.Path]::GetFullPath($androidAssetsParent)
if (!$resolvedTarget.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to delete unexpected Android asset path: $resolvedTarget"
}

if (Test-Path $androidAssets) {
  Remove-Item -LiteralPath $androidAssets -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $androidAssets | Out-Null
Copy-Item -Path (Join-Path $statusDist "*") -Destination $androidAssets -Recurse -Force
Write-Host "Android status assets synced: $androidAssets"
