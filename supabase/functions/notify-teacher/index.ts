// Supabase Edge Function: notify-teacher
// ---------------------------------------------------------------------------
// Sends an email notification to the teacher when a POD officer confirms an
// admission slip. Email is sent FROM the confirming officer's own mailbox via
// the Microsoft Graph API (client-credentials flow, Mail.Send application
// permission). Teams messaging is intentionally deferred (email only for now).
//
// Required Edge Function secrets (Project Settings -> Edge Functions -> Secrets):
//   GRAPH_TENANT_ID      Azure AD directory (tenant) ID
//   GRAPH_CLIENT_ID      App registration (client) ID
//   GRAPH_CLIENT_SECRET  App registration client secret value
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// The function verifies the caller's Supabase JWT (default behaviour), so only
// a logged-in POD user can trigger it. It re-reads the slip server-side with
// the service role, so the email content cannot be forged by the client.
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// deno-lint-ignore no-explicit-any
function buildEmail(slip: any, senderName: string) {
  const nature = Array.isArray(slip.nature) ? slip.nature.join(", ") : slip.nature || "";
  const subject = `POD Notice — ${slip.name} | ${nature} | ${slip.date || ""} ${slip.time_arrived || ""}`.trim();
  const subCat = slip.final_sub_category || slip.ai_sub_category || "";
  const rows: [string, unknown][] = [
    ["Student", slip.name],
    ["ID", slip.student_id],
    ["Grade / Section", slip.grade_section],
    ["Nature", nature + (slip.meridiem ? ` (${slip.meridiem})` : "")],
    ["Sub-category", subCat],
    ["Time Arrived", slip.time_arrived],
    ["Date", slip.date],
    ["Reason", slip.reason],
    ["Status", slip.status],
    ["Confirmed by", senderName],
  ];
  const trs = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;font-weight:600;color:#475569;white-space:nowrap;">${esc(
          k,
        )}</td><td style="padding:6px 12px;color:#0f172a;">${esc(v)}</td></tr>`,
    )
    .join("");
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;">
    <div style="background:#1e40af;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;">
      Discipline Office — Check-In Notice
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:16px 6px;">
      <p style="color:#334155;margin:0 12px 12px;">A student from your class reported to the Discipline Office.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">${trs}</table>
      <p style="color:#94a3b8;font-size:12px;margin:16px 12px 0;">
        This is an automated notification from the Ateneo de Iloilo Discipline Office.
      </p>
    </div>
  </div>`;
  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server not configured" }, 500);
  const admin = createClient(supabaseUrl, serviceKey);

  let slipId: number | string | undefined;
  let senderEmail: string | undefined;
  let senderName: string | undefined;
  try {
    const body = await req.json();
    slipId = body.slipId;
    senderEmail = body.senderEmail;
    senderName = body.senderName;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!slipId || !senderEmail) return json({ error: "slipId and senderEmail are required" }, 400);

  // Re-read the slip server-side (source of truth for the email content).
  const { data: slip, error: slipErr } = await admin
    .from("admission_slips")
    .select("*")
    .eq("id", slipId)
    .single();
  if (slipErr || !slip) return json({ error: "Slip not found" }, 404);

  const logNotif = (status: string, errorMessage: string | null, recipient: string | null) =>
    admin.from("notification_log").insert({
      slip_id: slip.id,
      channel: "email",
      sender_email: senderEmail,
      recipient_email: recipient,
      status,
      error_message: errorMessage,
    });

  if (!slip.teacher_email) {
    await logNotif("skipped", "No teacher email on file", null);
    return json({ status: "skipped", reason: "No teacher email on file for this slip" });
  }

  // 1) Acquire a Graph token (client-credentials).
  const tenant = Deno.env.get("GRAPH_TENANT_ID");
  const clientId = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");
  if (!tenant || !clientId || !clientSecret) {
    await logNotif("failed", "Graph credentials not configured", slip.teacher_email);
    return json({ error: "Email service not configured (missing Graph secrets)" }, 500);
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    const msg = tokenJson.error_description || tokenJson.error || "Token request failed";
    await logNotif("failed", `Auth: ${msg}`, slip.teacher_email);
    return json({ error: "Could not authenticate with Microsoft Graph", detail: msg }, 502);
  }

  // 2) Send the mail as the confirming officer.
  const { subject, html } = buildEmail(slip, senderName || senderEmail);
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenJson.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: slip.teacher_email } }],
        },
        saveToSentItems: true,
      }),
    },
  );

  if (!sendRes.ok) {
    const detail = await sendRes.text();
    await logNotif("failed", `Send ${sendRes.status}: ${detail.slice(0, 400)}`, slip.teacher_email);
    return json({ error: "Failed to send email", detail }, 502);
  }

  // 3) Mark the slip as notified + log success.
  await admin
    .from("admission_slips")
    .update({ notification_sent: true, notification_sent_at: new Date().toISOString() })
    .eq("id", slip.id);
  await logNotif("sent", null, slip.teacher_email);

  return json({ status: "sent", to: slip.teacher_email });
});
