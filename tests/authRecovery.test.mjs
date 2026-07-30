import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_AUTH_RECOVERY_REDIRECT_URL,
  establishSupabaseRecoverySession,
  parseDesktopAuthRecoveryCallback
} from "../src/authRecovery.js";

const require = createRequire(import.meta.url);
const {
  AUTH_RECOVERY_REDIRECT_URL,
  authRecoveryUrlFromArgv,
  sanitizeAuthRecoveryUrl
} = require("../electron/auth-recovery-link.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Electron accepts only the exact password-recovery deep-link route", () => {
  const valid = `${AUTH_RECOVERY_REDIRECT_URL}#type=recovery&access_token=secret`;
  assert.equal(sanitizeAuthRecoveryUrl(valid), valid);
  assert.equal(authRecoveryUrlFromArgv(["YDGlassManager.exe", "--flag", `"${valid}"`]), valid);
  for (const rejected of [
    "https://auth/recovery?code=abcdefghijklmnop",
    "ydglassmanager://orders/recovery?code=abcdefghijklmnop",
    "ydglassmanager://auth/other?code=abcdefghijklmnop",
    "ydglassmanager://user:pass@auth/recovery?code=abcdefghijklmnop",
    "ydglassmanager://auth:444/recovery?code=abcdefghijklmnop",
    "ydglassmanager://auth/recovery\u0000?code=abcdefghijklmnop"
  ]) {
    assert.equal(sanitizeAuthRecoveryUrl(rejected), "", rejected);
  }
});

test("renderer parses recovery fragments without accepting unrelated auth callbacks", () => {
  const parsed = parseDesktopAuthRecoveryCallback(
    `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}#access_token=abcdefghijklmnop.qrstuvwxyz&refresh_token=zyxwvutsrqponmlk&type=recovery`
  );
  assert.deepEqual(parsed, {
    flow: "implicit",
    accessToken: "abcdefghijklmnop.qrstuvwxyz",
    refreshToken: "zyxwvutsrqponmlk"
  });
  assert.throws(
    () => parseDesktopAuthRecoveryCallback(
      `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}#access_token=abcdefghijklmnop&refresh_token=zyxwvutsrqponmlk&type=signup`
    ),
    /لا يخص استعادة/
  );
  assert.throws(
    () => parseDesktopAuthRecoveryCallback(
      `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}#access_token=abcdefghijklmnop&refresh_token=zyxwvutsrqponmlk`
    ),
    /غير صالحة/
  );
  assert.throws(
    () => parseDesktopAuthRecoveryCallback(
      `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}?error=access_denied#error_description=do-not-display`
    ),
    /انتهت صلاحية/
  );
});

test("renderer establishes implicit and PKCE recovery sessions through Supabase", async () => {
  const calls = [];
  const session = { user: { id: "auth-user-id" } };
  const client = {
    auth: {
      setSession: async (value) => {
        calls.push(["setSession", value]);
        return { data: { session }, error: null };
      },
      exchangeCodeForSession: async (value) => {
        calls.push(["exchangeCodeForSession", value]);
        return { data: { session }, error: null };
      }
    }
  };
  assert.equal(
    await establishSupabaseRecoverySession(
      client,
      `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}#access_token=abcdefghijklmnop&refresh_token=zyxwvutsrqponmlk&type=recovery`
    ),
    session
  );
  assert.equal(
    await establishSupabaseRecoverySession(
      client,
      `${DESKTOP_AUTH_RECOVERY_REDIRECT_URL}?code=abcdefghijklmnop`
    ),
    session
  );
  assert.deepEqual(calls, [
    ["setSession", {
      access_token: "abcdefghijklmnop",
      refresh_token: "zyxwvutsrqponmlk"
    }],
    ["exchangeCodeForSession", "abcdefghijklmnop"]
  ]);
});

test("packaged integration registers, queues, and exposes one-time recovery callbacks", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.deepEqual(packageJson.build.protocols, [{
    name: "Y.D Glass Manager password recovery",
    schemes: ["ydglassmanager"]
  }]);
  assert.match(mainSource, /app\.setAsDefaultProtocolClient\(AUTH_RECOVERY_PROTOCOL/);
  assert.match(mainSource, /app\.on\("open-url"/);
  assert.match(mainSource, /app\.on\("second-instance"[\s\S]*authRecoveryUrlFromArgv\(commandLine\)/);
  assert.match(mainSource, /ipcMain\.handle\("glass-orders:consume-auth-recovery-url"/);
  assert.match(preloadSource, /consumeAuthRecoveryUrl:/);
  assert.match(preloadSource, /onAuthRecoveryUrl:/);
  assert.match(rendererSource, /establishSupabaseRecoverySession\(client, callbackUrl\)/);
  assert.match(rendererSource, /window\.glassOrdersDesktop\?\.authRecoveryRedirectUrl === DESKTOP_AUTH_RECOVERY_REDIRECT_URL/);
  assert.match(rendererSource, /minLength=\{10\}/);
});

test("every recovery success and cancel path clears the temporary Supabase session", () => {
  const rendererSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
  assert.match(
    rendererSource,
    /async function clearSupabaseRecoverySession[\s\S]*signOut\?\.\(\{ scope: "local" \}\)[\s\S]*clearSupabaseAuthStorage\(\)[\s\S]*resetSupabaseClientCache\(\)[\s\S]*setCurrentUser\(null\)[\s\S]*setRecoveryOpen\(false\)/
  );
  assert.equal(
    [...rendererSource.matchAll(/await clearSupabaseRecoverySession\(setPasswordRecoveryOpen, setCurrentUser\)/g)].length,
    4,
    "full and status variants must clear on both successful update and cancel"
  );
  assert.doesNotMatch(
    rendererSource,
    /PasswordRecoveryModal[\s\S]{0,220}onClose=\{\(\) => setPasswordRecoveryOpen\(false\)\}/
  );
  assert.match(
    rendererSource,
    /function PasswordRecoveryModal[\s\S]*onClick=\{onClose\} disabled=\{busy\}/
  );
});
