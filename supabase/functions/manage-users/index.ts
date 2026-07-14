// manage-users — admin-only user management for the POD Check-In system.
//
// Actions (POST JSON { action, ... }):
//   create         { email, full_name, role, password }  -> makes an auth user + profile
//   update         { id, full_name?, role? }             -> edits name / role
//   set_active     { id, is_active }                     -> activate / deactivate
//   reset_password { id, password }                      -> set a new temp password
//
// Security model:
//   * Runs with the service-role key (auto-injected), so it can use the Auth
//     admin API. This is the ONLY safe place for these operations — never the browser.
//   * verify_jwt is DISABLED at the platform level so CORS preflight works; the
//     caller is instead authenticated INSIDE via getUser(), then authorised by
//     role + a strict rank hierarchy. This is at least as strict as verify_jwt.
//   * Rank: superadmin(3) > pod_admin(2) > pod_staff(1) > faculty(0).
//     A caller may only act on, and assign, roles STRICTLY BELOW their own.
//     So only a superadmin can mint a pod_admin; superadmin is never created here.
//   * Callers cannot act on their own account (no self-demote / self-deactivate).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RANK: Record<string, number> = { superadmin: 3, pod_admin: 2, pod_staff: 1, faculty: 0 };
const ASSIGNABLE = new Set(["pod_admin", "pod_staff", "faculty"]); // superadmin intentionally excluded
const ALLOWED_DOMAIN = "@adi.edu.ph";
const MIN_PASSWORD = 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // Identify the caller from their JWT.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
  const callerId = userData.user.id;

  // Privileged client for admin reads/writes.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: caller, error: cErr } = await admin
    .from("profiles").select("id, role, is_active").eq("id", callerId).single();
  if (cErr || !caller) return json({ error: "Profile not found" }, 403);
  if (!caller.is_active) return json({ error: "Your account is inactive" }, 403);

  const callerRank = RANK[caller.role] ?? -1;
  if (callerRank < RANK.pod_admin) return json({ error: "Not authorized" }, 403);

  const canManageRole = (role: string) => {
    const r = RANK[role];
    return r !== undefined && r < callerRank;
  };

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = body?.action;

  // Loads a target profile and checks the caller outranks them + not self.
  async function loadTarget(id: string) {
    if (!id) return { err: json({ error: "Missing user id" }, 400) };
    if (id === caller.id) return { err: json({ error: "You cannot act on your own account here" }, 403) };
    const { data: target, error } = await admin
      .from("profiles").select("id, role").eq("id", id).single();
    if (error || !target) return { err: json({ error: "User not found" }, 404) };
    if (!canManageRole(target.role)) return { err: json({ error: "You cannot manage this user" }, 403) };
    return { target };
  }

  try {
    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const full_name = String(body.full_name || "").trim();
      const role = String(body.role || "");
      const password = String(body.password || "");
      if (!email.endsWith(ALLOWED_DOMAIN)) return json({ error: `Email must end in ${ALLOWED_DOMAIN}` }, 400);
      if (!full_name) return json({ error: "Full name is required" }, 400);
      if (!ASSIGNABLE.has(role) || !canManageRole(role)) return json({ error: "You cannot assign that role" }, 403);
      if (password.length < MIN_PASSWORD) return json({ error: `Temp password must be at least ${MIN_PASSWORD} characters` }, 400);

      // email_confirm: true so the account can sign in immediately (no email step).
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (createErr) return json({ error: createErr.message }, 400);
      const newId = created.user.id;

      // The handle_new_user trigger inserts a default profiles row; upsert the
      // chosen role/name and force a password change on first login.
      const { error: upErr } = await admin.from("profiles").upsert({
        id: newId, email, full_name, role, is_active: true,
        must_change_password: true, updated_at: new Date().toISOString(),
      });
      if (upErr) {
        await admin.auth.admin.deleteUser(newId); // don't orphan an auth user
        return json({ error: "Could not set profile: " + upErr.message }, 400);
      }
      return json({ ok: true, id: newId });
    }

    if (action === "update") {
      const { err, target } = await loadTarget(String(body.id || ""));
      if (err) return err;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.full_name === "string") patch.full_name = body.full_name.trim();
      if (body.role !== undefined) {
        const role = String(body.role);
        if (!ASSIGNABLE.has(role) || !canManageRole(role)) return json({ error: "You cannot assign that role" }, 403);
        patch.role = role;
      }
      const { error: upErr } = await admin.from("profiles").update(patch).eq("id", target!.id);
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ ok: true });
    }

    if (action === "set_active") {
      const { err, target } = await loadTarget(String(body.id || ""));
      if (err) return err;
      const { error: upErr } = await admin.from("profiles")
        .update({ is_active: !!body.is_active, updated_at: new Date().toISOString() })
        .eq("id", target!.id);
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const password = String(body.password || "");
      if (password.length < MIN_PASSWORD) return json({ error: `Temp password must be at least ${MIN_PASSWORD} characters` }, 400);
      const { err, target } = await loadTarget(String(body.id || ""));
      if (err) return err;
      const { error: pwErr } = await admin.auth.admin.updateUserById(target!.id, { password });
      if (pwErr) return json({ error: pwErr.message }, 400);
      const { error: upErr } = await admin.from("profiles")
        .update({ must_change_password: true, updated_at: new Date().toISOString() })
        .eq("id", target!.id);
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
