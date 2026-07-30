export const DESKTOP_AUTH_RECOVERY_REDIRECT_URL = "ydglassmanager://auth/recovery";

const MAX_CALLBACK_LENGTH = 16_384;
const MAX_SECRET_LENGTH = 8_192;

function singleParameter(search, key) {
  const values = search.getAll(key);
  if (values.length > 1) throw new Error("رابط استعادة كلمة المرور غير صالح.");
  return values[0] || "";
}

function validSecret(value, minimumLength = 16) {
  return (
    value.length >= minimumLength &&
    value.length <= MAX_SECRET_LENGTH &&
    !/[\s\u0000-\u001f\u007f]/.test(value)
  );
}

export function parseDesktopAuthRecoveryCallback(value) {
  const callbackUrl = String(value || "").trim();
  if (
    !callbackUrl ||
    callbackUrl.length > MAX_CALLBACK_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(callbackUrl)
  ) {
    throw new Error("رابط استعادة كلمة المرور غير صالح.");
  }

  let parsed;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new Error("رابط استعادة كلمة المرور غير صالح.");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (
    parsed.protocol !== "ydglassmanager:" ||
    parsed.hostname !== "auth" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    pathname !== "/recovery"
  ) {
    throw new Error("تم رفض رابط لا يخص استعادة كلمة المرور.");
  }

  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const errorCode = singleParameter(query, "error") || singleParameter(fragment, "error");
  if (errorCode) {
    throw new Error("انتهت صلاحية رابط الاستعادة أو تم استخدامه من قبل.");
  }

  const queryType = singleParameter(query, "type");
  const fragmentType = singleParameter(fragment, "type");
  if (queryType && fragmentType && queryType !== fragmentType) {
    throw new Error("رابط استعادة كلمة المرور غير صالح.");
  }
  const recoveryType = queryType || fragmentType;
  if (recoveryType && recoveryType !== "recovery") {
    throw new Error("تم رفض رابط مصادقة لا يخص استعادة كلمة المرور.");
  }

  const code = singleParameter(query, "code");
  const accessToken = singleParameter(fragment, "access_token");
  const refreshToken = singleParameter(fragment, "refresh_token");
  if (code && (accessToken || refreshToken)) {
    throw new Error("رابط استعادة كلمة المرور غير صالح.");
  }

  if (code) {
    if (!validSecret(code)) throw new Error("رمز استعادة كلمة المرور غير صالح.");
    return { flow: "pkce", code };
  }

  if (!accessToken && !refreshToken) {
    throw new Error("لا يحتوي رابط الاستعادة على جلسة صالحة.");
  }
  if (
    recoveryType !== "recovery" ||
    !validSecret(accessToken) ||
    !validSecret(refreshToken)
  ) {
    throw new Error("جلسة استعادة كلمة المرور غير صالحة.");
  }
  return { flow: "implicit", accessToken, refreshToken };
}

export async function establishSupabaseRecoverySession(client, callbackUrl) {
  if (!client?.auth) throw new Error("اتصال Supabase غير متاح.");
  const callback = parseDesktopAuthRecoveryCallback(callbackUrl);
  const result = callback.flow === "pkce"
    ? await client.auth.exchangeCodeForSession(callback.code)
    : await client.auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken
    });

  if (result?.error || !result?.data?.session?.user?.id) {
    throw new Error("تعذر التحقق من جلسة استعادة كلمة المرور.");
  }
  return result.data.session;
}
