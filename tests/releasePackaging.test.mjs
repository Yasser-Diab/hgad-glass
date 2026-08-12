import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const androidReleaseScript = readFileSync(new URL("../scripts/build_android_release.ps1", import.meta.url), "utf8");
const packageReleaseScript = readFileSync(new URL("../scripts/package_release.ps1", import.meta.url), "utf8");

test("package release falls back to debug Android APKs when signing is unavailable", () => {
  assert.match(androidReleaseScript, /function Invoke-DebugBuildFallback/);
  assert.match(androidReleaseScript, /Invoke-DebugBuildFallback "Android release signing is not configured/);
  assert.match(androidReleaseScript, /Invoke-DebugBuildFallback "Android release keystore was not found/);
  assert.match(androidReleaseScript, /npm run android:debug/);
  assert.match(androidReleaseScript, /Production-signed Android release APKs will not be produced/);

  assert.match(packageReleaseScript, /YDGlassManager-Full-\$version\.apk/);
  assert.match(packageReleaseScript, /YDGlassManager-Full-Android-debug-v\$version\.apk/);
  assert.match(packageReleaseScript, /YDGlassManager-OrderStatus-\$version\.apk/);
  assert.match(packageReleaseScript, /YDGlassManager-OrderStatus-Android-debug-v\$version\.apk/);
  assert.match(packageReleaseScript, /Release folder includes debug-signed Android APKs/);
});
