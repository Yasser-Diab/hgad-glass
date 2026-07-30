import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.0";

type JsonObject = Record<string, unknown>;

type AppProfile = {
  id: string;
  username: string;
  email: string | null;
  auth_user_id: string | null;
  display_name: string;
  role: string;
  can_view_costs: boolean;
  is_active: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(payload: JsonObject, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache"
    }
  });
}

function cleanText(value: unknown, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizedEmail(value: unknown) {
  const email = cleanText(value, 320).toLocaleLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "اكتب بريداً إلكترونياً صالحاً.");
  }
  return email;
}

function validatedUsername(value: unknown) {
  const username = cleanText(value, 80);
  if (username.length < 2 || /[\u0000-\u001f\u007f]/.test(username) || username.includes("@")) {
    throw new HttpError(400, "اسم الدخول غير صالح.");
  }
  return username;
}

function validatedPassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < 10 || password.length > 256) {
    throw new HttpError(400, "كلمة المرور يجب ألا تقل عن 10 أحرف.");
  }
  return password;
}

function environment() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anonKey || !serviceRoleKey) {
    throw new HttpError(503, "خدمة تسجيل الدخول غير مهيأة.");
  }
  return { url, anonKey, serviceRoleKey };
}

function createAdminClient() {
  const { url, serviceRoleKey } = environment();
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function createPublicAuthClient(authorization = "") {
  const { url, anonKey } = environment();
  return createClient(url, anonKey, {
    global: authorization ? { headers: { Authorization: authorization } } : undefined,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function publicProfile(profile: AppProfile) {
  return {
    id: profile.id,
    username: profile.username,
    email: profile.email || "",
    auth_user_id: profile.auth_user_id || "",
    display_name: profile.display_name,
    role: profile.role === "admin" ? "admin" : "user",
    can_view_costs: profile.role === "admin" || profile.can_view_costs === true,
    is_active: profile.is_active !== false
  };
}

async function resolveProfile(admin: SupabaseClient, identity: unknown, includeInactive = false) {
  const normalizedIdentity = cleanText(identity, 320);
  if (!normalizedIdentity) return null;
  const result = await admin.rpc("glass_auth_resolve_profile", {
    p_identity: normalizedIdentity,
    p_include_inactive: includeInactive
  });
  if (result.error) throw new HttpError(503, "تعذر قراءة ملف المستخدم الآمن.");
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  return (rows[0] || null) as AppProfile | null;
}

async function profileById(admin: SupabaseClient, profileId: unknown) {
  const id = cleanText(profileId, 80);
  if (!id) throw new HttpError(400, "معرّف المستخدم مطلوب.");
  const result = await admin
    .from("users")
    .select("id,username,email,auth_user_id,display_name,role,can_view_costs,is_active")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new HttpError(500, "تعذر قراءة المستخدم.");
  if (!result.data) throw new HttpError(404, "المستخدم غير موجود.");
  return result.data as AppProfile;
}

async function profileByAuthId(admin: SupabaseClient, authUserId: string) {
  const result = await admin
    .from("users")
    .select("id,username,email,auth_user_id,display_name,role,can_view_costs,is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (result.error) throw new HttpError(500, "تعذر قراءة ملف المستخدم.");
  return (result.data || null) as AppProfile | null;
}

async function requireActiveAdmin(request: Request, admin: SupabaseClient) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new HttpError(401, "يلزم تسجيل الدخول.");
  }
  const authClient = createPublicAuthClient(authorization);
  const authResult = await authClient.auth.getUser();
  if (authResult.error || !authResult.data.user?.id) {
    throw new HttpError(401, "جلسة الدخول غير صالحة.");
  }
  const profile = await profileByAuthId(admin, authResult.data.user.id);
  if (!profile || profile.is_active === false || profile.role !== "admin") {
    throw new HttpError(403, "هذه العملية متاحة لمدير النظام فقط.");
  }
  return { authUser: authResult.data.user, profile };
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw new HttpError(500, "تعذر فحص حساب Supabase Auth.");
    const users = result.data.users || [];
    const match = users.find((user) => String(user.email || "").toLocaleLowerCase() === email);
    if (match) return match;
    if (users.length < 200) break;
  }
  return null;
}

async function createOrUpdateAuthIdentity(
  admin: SupabaseClient,
  input: { email: string; username: string; displayName: string; password?: string },
  knownAuthUserId = "",
  expectedProfileId = ""
) {
  const attributes = {
    email: input.email,
    email_confirm: true,
    user_metadata: {
      username: input.username,
      display_name: input.displayName
    },
    ...(input.password ? { password: input.password } : {})
  };
  let authUser: User | null = null;
  let created = false;
  if (knownAuthUserId) {
    const updated = await admin.auth.admin.updateUserById(knownAuthUserId, attributes);
    if (updated.error || !updated.data.user) {
      throw new HttpError(400, "تعذر تحديث حساب Supabase Auth المرتبط.");
    }
    authUser = updated.data.user;
  } else {
    authUser = await findAuthUserByEmail(admin, input.email);
    if (authUser) {
      const linkedProfile = await profileByAuthId(admin, authUser.id);
      if (linkedProfile && linkedProfile.id !== expectedProfileId) {
        throw new HttpError(409, "حساب Supabase Auth مرتبط بمستخدم آخر.");
      }
      const updated = await admin.auth.admin.updateUserById(authUser.id, attributes);
      if (updated.error || !updated.data.user) {
        throw new HttpError(400, "تعذر تجهيز حساب Supabase Auth الموجود.");
      }
      authUser = updated.data.user;
    } else {
      const createdResult = await admin.auth.admin.createUser(attributes);
      if (createdResult.error || !createdResult.data.user) {
        throw new HttpError(400, "تعذر إنشاء حساب Supabase Auth.");
      }
      authUser = createdResult.data.user;
      created = true;
    }
  }
  return { authUser, created };
}

async function recordAudit(
  admin: SupabaseClient,
  actorAuthUserId: string,
  action: string,
  target: { profileId?: string; authUserId?: string },
  details: JsonObject = {}
) {
  const result = await admin.from("glass_auth_admin_audit").insert({
    actor_auth_user_id: actorAuthUserId,
    target_profile_id: target.profileId || null,
    target_auth_user_id: target.authUserId || null,
    action,
    details
  });
  if (result.error) {
    console.error("glass-auth audit insert failed", result.error.code || "unknown");
  }
}

async function login(admin: SupabaseClient, body: JsonObject) {
  const identity = cleanText(body.identity, 320);
  const password = String(body.password || "");
  if (!identity || !password) throw new HttpError(401, "بيانات الدخول غير صحيحة.");
  const profile = await resolveProfile(admin, identity, false);
  if (!profile?.auth_user_id || !profile.email || profile.is_active === false) {
    throw new HttpError(401, "بيانات الدخول غير صحيحة.");
  }
  const authClient = createPublicAuthClient();
  const authResult = await authClient.auth.signInWithPassword({
    email: profile.email,
    password
  });
  if (
    authResult.error
    || !authResult.data.user?.id
    || authResult.data.user.id !== profile.auth_user_id
    || !authResult.data.session?.access_token
    || !authResult.data.session.refresh_token
  ) {
    throw new HttpError(401, "بيانات الدخول غير صحيحة.");
  }
  const lastLoginResult = await admin
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", profile.id);
  if (lastLoginResult.error) {
    console.error("glass-auth last_login_at update failed", lastLoginResult.error.code || "unknown");
  }
  const session = authResult.data.session;
  return {
    profile: publicProfile(profile),
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: session.token_type
    }
  };
}

function configuredResetRedirect(requested: unknown) {
  const candidate = cleanText(requested, 1000);
  if (candidate === "ydglassmanager://auth/recovery") return candidate;
  const configured = cleanText(Deno.env.get("GLASS_AUTH_REDIRECT_URL"), 1000);
  if (configured) return configured;
  if (!candidate) return "";
  const allowList = String(Deno.env.get("GLASS_AUTH_ALLOWED_REDIRECTS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowList.includes(candidate) ? candidate : "";
}

async function requestPasswordReset(admin: SupabaseClient, body: JsonObject) {
  const generic = {
    accepted: true,
    message: "إذا كان الحساب مرتبطاً ببريد صالح فسيصل رابط إعادة التعيين."
  };
  const profile = await resolveProfile(admin, body.identity, false);
  if (!profile?.auth_user_id || !profile.email || profile.is_active === false) return generic;
  const authUserResult = await admin.auth.admin.getUserById(profile.auth_user_id);
  const authEmail = String(authUserResult.data.user?.email || "").toLocaleLowerCase();
  if (authUserResult.error || !authEmail || authEmail !== profile.email.toLocaleLowerCase()) return generic;
  const authClient = createPublicAuthClient();
  const redirectTo = configuredResetRedirect(body.redirectTo);
  const resetResult = await authClient.auth.resetPasswordForEmail(
    authEmail,
    redirectTo ? { redirectTo } : undefined
  );
  if (resetResult.error) {
    console.error("glass-auth password reset request failed", resetResult.error.code || "unknown");
  }
  return generic;
}

async function adminCreateUser(request: Request, admin: SupabaseClient, body: JsonObject) {
  const actor = await requireActiveAdmin(request, admin);
  const rawProfile = (body.profile || {}) as JsonObject;
  const username = validatedUsername(rawProfile.username);
  const email = normalizedEmail(rawProfile.email);
  const displayName = cleanText(rawProfile.display_name, 160);
  const password = validatedPassword(body.password);
  if (!displayName) throw new HttpError(400, "الاسم في التقارير مطلوب.");
  const usernameConflict = await resolveProfile(admin, username, true);
  const emailConflict = await resolveProfile(admin, email, true);
  if (usernameConflict || emailConflict) throw new HttpError(409, "اسم الدخول أو البريد مستخدم بالفعل.");

  const role = rawProfile.role === "admin" ? "admin" : "user";
  const canViewCosts = role === "admin" || rawProfile.can_view_costs === true;
  const isActive = rawProfile.is_active !== false;
  const identity = await createOrUpdateAuthIdentity(admin, {
    email,
    username,
    displayName,
    password
  });

  try {
    let profile = await profileByAuthId(admin, identity.authUser.id);
    if (!profile) {
      const inserted = await admin.from("users").insert({
        username,
        email,
        auth_user_id: identity.authUser.id,
        display_name: displayName,
        role,
        can_view_costs: canViewCosts,
        is_active: isActive
      }).select("id,username,email,auth_user_id,display_name,role,can_view_costs,is_active").single();
      if (inserted.error || !inserted.data) throw new HttpError(500, "تعذر إنشاء ملف المستخدم.");
      profile = inserted.data as AppProfile;
    } else {
      const updated = await admin.from("users").update({
        username,
        email,
        auth_user_id: identity.authUser.id,
        display_name: displayName,
        role,
        can_view_costs: canViewCosts,
        is_active: isActive
      }).eq("id", profile.id).select("id,username,email,auth_user_id,display_name,role,can_view_costs,is_active").single();
      if (updated.error || !updated.data) throw new HttpError(500, "تعذر تحديث ملف المستخدم.");
      profile = updated.data as AppProfile;
    }
    await recordAudit(admin, actor.authUser.id, "create_user", {
      profileId: profile.id,
      authUserId: identity.authUser.id
    }, { role, is_active: isActive });
    return { profile: publicProfile(profile) };
  } catch (error) {
    if (identity.created) {
      await admin.auth.admin.deleteUser(identity.authUser.id).catch(() => null);
    }
    throw error;
  }
}

async function adminUpdateUser(request: Request, admin: SupabaseClient, body: JsonObject) {
  const actor = await requireActiveAdmin(request, admin);
  const profile = await profileById(admin, body.profileId);
  const patch = (body.patch || {}) as JsonObject;
  const next = {
    username: patch.username === undefined ? profile.username : validatedUsername(patch.username),
    email: patch.email === undefined ? normalizedEmail(profile.email) : normalizedEmail(patch.email),
    display_name: patch.display_name === undefined ? profile.display_name : cleanText(patch.display_name, 160),
    role: patch.role === undefined ? profile.role : patch.role === "admin" ? "admin" : "user",
    can_view_costs: patch.can_view_costs === undefined ? profile.can_view_costs === true : patch.can_view_costs === true,
    is_active: patch.is_active === undefined ? profile.is_active !== false : patch.is_active === true
  };
  if (!next.display_name) throw new HttpError(400, "الاسم في التقارير مطلوب.");
  if (next.role === "admin") next.can_view_costs = true;
  if (profile.auth_user_id === actor.authUser.id && (next.role !== "admin" || !next.is_active)) {
    throw new HttpError(400, "لا يمكن للمدير إيقاف حسابه الحالي أو إزالة صلاحية الإدارة منه.");
  }
  const usernameConflict = await resolveProfile(admin, next.username, true);
  const emailConflict = await resolveProfile(admin, next.email, true);
  if (usernameConflict && usernameConflict.id !== profile.id) throw new HttpError(409, "اسم الدخول مستخدم بالفعل.");
  if (emailConflict && emailConflict.id !== profile.id) throw new HttpError(409, "البريد مستخدم بالفعل.");

  const newPassword = String(body.newPassword || "");
  let authUserId = profile.auth_user_id || "";
  const authNeedsUpdate = Boolean(
    authUserId
    && (newPassword || next.email !== profile.email || next.username !== profile.username || next.display_name !== profile.display_name)
  );
  if (newPassword) validatedPassword(newPassword);
  if (authNeedsUpdate || (!authUserId && newPassword)) {
    const identity = await createOrUpdateAuthIdentity(admin, {
      email: next.email,
      username: next.username,
      displayName: next.display_name,
      password: newPassword || undefined
    }, authUserId, profile.id);
    authUserId = identity.authUser.id;
  } else if (!authUserId && !newPassword && next.email !== profile.email) {
    // The email may be corrected before an administrator provisions a password.
    authUserId = "";
  }

  const updated = await admin.from("users").update({
    username: next.username,
    email: next.email,
    auth_user_id: authUserId || null,
    display_name: next.display_name,
    role: next.role,
    can_view_costs: next.can_view_costs,
    is_active: next.is_active
  }).eq("id", profile.id).select("id,username,email,auth_user_id,display_name,role,can_view_costs,is_active").single();
  if (updated.error || !updated.data) throw new HttpError(500, "تعذر تحديث ملف المستخدم.");
  const saved = updated.data as AppProfile;
  await recordAudit(admin, actor.authUser.id, newPassword ? "set_password" : "update_user", {
    profileId: saved.id,
    authUserId: saved.auth_user_id || undefined
  }, {
    changed_fields: Object.keys(patch).filter((key) => key !== "password"),
    password_changed: Boolean(newPassword)
  });
  return { profile: publicProfile(saved) };
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "الطريقة غير مدعومة." }, 405);
  try {
    const body = await request.json() as JsonObject;
    const action = cleanText(body.action, 80);
    const admin = createAdminClient();
    if (action === "login") return jsonResponse(await login(admin, body));
    if (action === "reset-password") return jsonResponse(await requestPasswordReset(admin, body));
    if (action === "admin-create-user") return jsonResponse(await adminCreateUser(request, admin, body));
    if (action === "admin-update-user") return jsonResponse(await adminUpdateUser(request, admin, body));
    throw new HttpError(400, "الإجراء غير معروف.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "تعذر إكمال عملية تسجيل الدخول.";
    return jsonResponse({ error: message }, status);
  }
}

export default {
  fetch: handleRequest
};
