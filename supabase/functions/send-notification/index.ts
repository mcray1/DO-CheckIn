// Supabase Edge Function: send-notification
// Sends a POD admission slip notification email to a teacher via Gmail API,
// authenticated as pod@adi.edu.ph using a service account with domain-wide delegation.
//
// Security model (mirrors manage-users):
//   * Runs with the service-role key, so it can read any slip and send mail.
//     Because the anon key is public, the caller MUST be authenticated and
//     authorised INSIDE the function — never trust that only staff can reach it.
//   * The caller is identified via getUser() and must be an active staff profile
//     (pod_staff / pod_admin / superadmin). Without this check, anyone with the
//     public anon key could send attacker-controlled email from pod@adi.edu.ph.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_CLIENT_EMAIL = Deno.env.get("GMAIL_CLIENT_EMAIL")!;
const GMAIL_PRIVATE_KEY = Deno.env.get("GMAIL_PRIVATE_KEY")!.replace(/\\n/g, "\n");
const POD_SENDER_EMAIL = Deno.env.get("POD_SENDER_EMAIL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const STAFF_ROLES = new Set(["pod_staff", "pod_admin", "superadmin"]);

// Only the school's own site may call this from a browser. Access-Control-Allow-
// Origin takes a single value, so the caller's origin is echoed back when it is
// on the allowlist and otherwise falls back to the canonical site (which makes
// the browser block the response). Add extra origins — e.g. a local dev server —
// via the CORS_ORIGINS env var, comma-separated.
const DEFAULT_ORIGINS = ["https://adi.edu.ph", "https://www.adi.edu.ph"];
const ALLOWED_ORIGINS = [
  ...DEFAULT_ORIGINS,
  ...(Deno.env.get("CORS_ORIGINS") || "").split(",").map((o) => o.trim()).filter(Boolean),
];

function corsFor(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin", // responses differ per origin; don't let a cache cross them
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonCors(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(origin), "Content-Type": "application/json" },
  });
}

// Escape a value for safe interpolation into HTML.
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strip CR/LF so a slip field can't inject extra email headers.
function headerSafe(v: unknown): string {
  return String(v ?? "").replace(/[\r\n]+/g, " ").trim();
}

// ── Build a signed JWT for Google OAuth (service account + delegation) ──
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: GMAIL_CLIENT_EMAIL,
    sub: POD_SENDER_EMAIL,           // impersonate pod@adi.edu.ph
    scope: "https://www.googleapis.com/auth/gmail.send",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const unsigned = `${enc(header)}.${enc(claim)}`;

  // Import the PEM private key
  const pem = GMAIL_PRIVATE_KEY
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binary.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsigned}.${sigB64}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token error: " + JSON.stringify(data));
  return data.access_token;
}

// ── Build a raw RFC 2822 email and base64url-encode it ──
function buildRawEmail(to: string, subject: string, htmlBody: string): string {
  const message = [
    `From: Ateneo de Iloilo Discipline Office <${POD_SENDER_EMAIL}>`,
    `To: ${headerSafe(to)}`,
    `Subject: ${headerSafe(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ].join("\r\n");

  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  // Per-request CORS. `json` shadows the module helper so every existing call
  // site below answers with headers scoped to this caller's origin.
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);
  const json = (body: unknown, status = 200) => jsonCors(body, status, origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // ── Authenticate + authorise the caller ──
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json({ ok: false, error: "Missing Authorization header" }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "Invalid session" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: caller, error: cErr } = await supabase
    .from("profiles").select("role, is_active").eq("id", userData.user.id).single();
  if (cErr || !caller) return json({ ok: false, error: "Profile not found" }, 403);
  if (!caller.is_active) return json({ ok: false, error: "Your account is inactive" }, 403);
  if (!STAFF_ROLES.has(caller.role)) return json({ ok: false, error: "Not authorized" }, 403);

  try {
    const { slip_id } = await req.json();
    if (!slip_id) throw new Error("Missing slip_id");

    const { data: slip, error: slipErr } = await supabase
      .from("admission_slips").select("*").eq("id", slip_id).single();
    if (slipErr || !slip) throw new Error("Slip not found");

    // Admin kill-switches, read together. Enforced here as well as in the UI so
    // nothing slips out while notifications are paused.
    const { data: settingRows } = await supabase
      .from("settings").select("key, value")
      .in("key", ["email_notifications_enabled", "student_email_notifications_enabled"]);
    const setting = (k: string) =>
      (settingRows || []).find((r: { key: string }) => r.key === k)?.value !== false;
    const adviserOn = setting("email_notifications_enabled");
    const studentOn = setting("student_email_notifications_enabled");

    // The student's address is read from the students table, never from the
    // slip: the kiosk writes slips as anon, so an address carried on the slip
    // could be forged. student_id on the slip is the student number.
    let studentEmail: string | null = null;
    if (studentOn && !slip.student_notification_sent && slip.student_id) {
      const { data: student } = await supabase
        .from("students").select("email").eq("student_no", slip.student_id).maybeSingle();
      studentEmail = student?.email?.trim() || null;
    }

    const shared = `
        <table style="font-size:14px; line-height:1.8;">
          <tr><td style="color:#64748b;">Student:</td><td><strong>${esc(slip.name)}</strong></td></tr>
          <tr><td style="color:#64748b;">ID:</td><td>${esc(slip.student_id)}</td></tr>
          <tr><td style="color:#64748b;">Grade/Section:</td><td>${esc(slip.grade_section || "—")}</td></tr>
          <tr><td style="color:#64748b;">Nature:</td><td>${esc((slip.nature || []).join(", "))} ${esc(slip.meridiem || "")}</td></tr>
          <tr><td style="color:#64748b;">Time Arrived:</td><td>${esc(slip.time_arrived)}</td></tr>
          <tr><td style="color:#64748b;">Reason:</td><td>${esc(slip.reason || "—")}</td></tr>
          <tr><td style="color:#64748b;">Status:</td><td><strong>${esc(slip.status || "Pending")}</strong></td></tr>
          <tr><td style="color:#64748b;">Confirmed by:</td><td>${esc(slip.confirmed_by || "—")}</td></tr>
        </table>`;
    const wrap = (heading: string, lead: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 520px;">
        <div style="border-bottom: 3px solid #1e40af; padding-bottom: 10px; margin-bottom: 16px;">
          <div style="font-size:12px; color:#64748b;">ATENEO DE ILOILO – SMCS · DISCIPLINE OFFICE</div>
          <div style="font-size:18px; font-weight:800; color:#1e40af;">${heading}</div>
        </div>
        <p>${lead}</p>${shared}
        <p style="font-size:12px; color:#94a3b8; margin-top:16px;">
          This is an automated notification from the Ateneo de Iloilo Discipline Office.
          Please see the Discipline Office if any detail is incorrect.
        </p>
      </div>`;

    const subject = `POD Notice — ${slip.name} | ${(slip.nature || []).join(", ")} | ${slip.date} ${slip.time_arrived}`;

    // Log → send → mark. Each recipient is independent so one failing address
    // can't stop the other from being told.
    async function deliver(to: string, html: string) {
      let logId: number | null = null;
      try {
        const { data: inserted } = await supabase.from("notification_log").insert({
          slip_id, channel: "email", recipient_email: to,
          subject, status: "pending", attempts: 1,
        }).select().single();
        logId = inserted?.id ?? null;

        const token = await getAccessToken();
        const gmailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(POD_SENDER_EMAIL)}/messages/send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ raw: buildRawEmail(to, subject, html) }),
          },
        );
        if (!gmailRes.ok) throw new Error("Gmail send failed: " + (await gmailRes.text()));

        if (logId) await supabase.from("notification_log").update({
          status: "sent", sent_at: new Date().toISOString(),
        }).eq("id", logId);
        return { ok: true as const };
      } catch (e) {
        const message = String((e as Error)?.message || e);
        if (logId) await supabase.from("notification_log").update({
          status: "failed", error_message: message,
        }).eq("id", logId);
        return { ok: false as const, error: message };
      }
    }

    const sent: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    // ── Adviser ──
    if (slip.notification_sent) skipped.push("adviser already notified");
    else if (!adviserOn) skipped.push("adviser emails are off");
    else if (!slip.teacher_email) skipped.push("no adviser email on slip");
    else {
      const r = await deliver(slip.teacher_email, wrap("Admission Slip Notice", "A student from your class has reported to the Discipline Office."));
      if (r.ok) {
        await supabase.from("admission_slips").update({
          notification_sent: true, notification_sent_at: new Date().toISOString(),
        }).eq("id", slip_id);
        sent.push("adviser");
      } else failed.push(`adviser: ${r.error}`);
    }

    // ── Student ──
    if (slip.student_notification_sent) skipped.push("student already notified");
    else if (!studentOn) skipped.push("student emails are off");
    else if (!studentEmail) skipped.push("no student email on file");
    else {
      const r = await deliver(studentEmail, wrap("Your Admission Slip", "You reported to the Discipline Office. Here is a copy of your admission slip for your records."));
      if (r.ok) {
        await supabase.from("admission_slips").update({
          student_notification_sent: true, student_notification_sent_at: new Date().toISOString(),
        }).eq("id", slip_id);
        sent.push("student");
      } else failed.push(`student: ${r.error}`);
    }

    if (failed.length) return json({ ok: false, error: failed.join("; "), sent }, 500);
    return json({ ok: true, sent, reason: sent.length ? undefined : skipped.join("; ") });

  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
