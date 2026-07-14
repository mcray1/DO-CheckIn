// Supabase Edge Function: send-notification
// Sends a POD admission slip notification email to a teacher via Gmail API,
// authenticated as pod@adi.edu.ph using a service account with domain-wide delegation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_CLIENT_EMAIL = Deno.env.get("GMAIL_CLIENT_EMAIL")!;
const GMAIL_PRIVATE_KEY = Deno.env.get("GMAIL_PRIVATE_KEY")!.replace(/\\n/g, "\n");
const POD_SENDER_EMAIL = Deno.env.get("POD_SENDER_EMAIL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ].join("\r\n");

  return btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { slip_id } = await req.json();
    if (!slip_id) throw new Error("Missing slip_id");

    // Fetch the slip
    const { data: slip, error: slipErr } = await supabase
      .from("admission_slips").select("*").eq("id", slip_id).single();
    if (slipErr || !slip) throw new Error("Slip not found");

    if (!slip.teacher_email) {
      return new Response(JSON.stringify({ ok: false, reason: "No teacher email on slip" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subject = `POD Notice — ${slip.name} | ${(slip.nature || []).join(", ")} | ${slip.date} ${slip.time_arrived}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px;">
        <div style="border-bottom: 3px solid #1e40af; padding-bottom: 10px; margin-bottom: 16px;">
          <div style="font-size:12px; color:#64748b;">ATENEO DE ILOILO – SMCS · DISCIPLINE OFFICE</div>
          <div style="font-size:18px; font-weight:800; color:#1e40af;">Admission Slip Notice</div>
        </div>
        <p>A student from your class has reported to the Discipline Office.</p>
        <table style="font-size:14px; line-height:1.8;">
          <tr><td style="color:#64748b;">Student:</td><td><strong>${slip.name}</strong></td></tr>
          <tr><td style="color:#64748b;">ID:</td><td>${slip.student_id}</td></tr>
          <tr><td style="color:#64748b;">Grade/Section:</td><td>${slip.grade_section || "—"}</td></tr>
          <tr><td style="color:#64748b;">Nature:</td><td>${(slip.nature || []).join(", ")} ${slip.meridiem || ""}</td></tr>
          <tr><td style="color:#64748b;">Time Arrived:</td><td>${slip.time_arrived}</td></tr>
          <tr><td style="color:#64748b;">Reason:</td><td>${slip.reason || "—"}</td></tr>
          <tr><td style="color:#64748b;">Status:</td><td><strong>${slip.status || "Pending"}</strong></td></tr>
          <tr><td style="color:#64748b;">Confirmed by:</td><td>${slip.confirmed_by || "—"}</td></tr>
        </table>
        <p style="font-size:12px; color:#94a3b8; margin-top:16px;">
          This is an automated notification from the Ateneo de Iloilo Discipline Office.
        </p>
      </div>`;

    // Log attempt
    const { data: logRow } = await supabase.from("notification_log").insert({
      slip_id, channel: "email", recipient_email: slip.teacher_email,
      subject, status: "pending", attempts: 1,
    }).select().single();

    // Send via Gmail
    const token = await getAccessToken();
    const raw = buildRawEmail(slip.teacher_email, subject, html);

    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(POD_SENDER_EMAIL)}/messages/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      },
    );

    if (!gmailRes.ok) {
      const errText = await gmailRes.text();
      if (logRow) await supabase.from("notification_log").update({
        status: "failed", error_message: errText,
      }).eq("id", logRow.id);
      throw new Error("Gmail send failed: " + errText);
    }

    // Mark success
    if (logRow) await supabase.from("notification_log").update({
      status: "sent", sent_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    await supabase.from("admission_slips").update({
      notification_sent: true, notification_sent_at: new Date().toISOString(),
    }).eq("id", slip_id);

    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
