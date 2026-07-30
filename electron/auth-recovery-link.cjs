"use strict";

const AUTH_RECOVERY_PROTOCOL = "ydglassmanager";
const AUTH_RECOVERY_REDIRECT_URL = `${AUTH_RECOVERY_PROTOCOL}://auth/recovery`;
const MAX_AUTH_RECOVERY_URL_LENGTH = 16_384;

function trimCommandLineValue(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
    return text.slice(1, -1);
  }
  return text;
}

function sanitizeAuthRecoveryUrl(value) {
  const candidate = trimCommandLineValue(value);
  if (
    !candidate ||
    candidate.length > MAX_AUTH_RECOVERY_URL_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    if (
      parsed.protocol !== `${AUTH_RECOVERY_PROTOCOL}:` ||
      parsed.hostname !== "auth" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      pathname !== "/recovery"
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function authRecoveryUrlFromArgv(argv = []) {
  for (const argument of Array.isArray(argv) ? argv : []) {
    const safeUrl = sanitizeAuthRecoveryUrl(argument);
    if (safeUrl) return safeUrl;
  }
  return "";
}

module.exports = {
  AUTH_RECOVERY_PROTOCOL,
  AUTH_RECOVERY_REDIRECT_URL,
  authRecoveryUrlFromArgv,
  sanitizeAuthRecoveryUrl
};
