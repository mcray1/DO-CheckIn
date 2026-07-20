import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";

// Superadmin-only permission matrix (roles x capabilities). Presence of a
// (role, permission) row in role_permissions = granted. superadmin is implicit-all
// and shown locked; the row-level policy (20260717_role_permissions) is the real gate.


const PERMISSIONS = [
  ["confirm_slips", "Confirm / override slips"],
  ["manage_categories", "Manage categories & keywords"],
  ["manage_users", "Manage user accounts"],
  ["manage_directory", "Manage advisers & students"],
  ["manage_settings", "Manage settings"],
  ["view_reports", "View reports"],
];
// superadmin is intentionally excluded from the editable columns (always-all).
const ROLES = [
  ["pod_admin", "Admin"],
  ["pod_staff", "Staff"],
  ["faculty", "Faculty"],
];

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

const keyOf = (role, perm) => `${role}|${perm}`;

export default function Roles() {
  const [granted, setGranted] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null); // key currently saving

  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/role_permissions?select=role,permission`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      setGranted(new Set(rows.map(r => keyOf(r.role, r.permission))));
    } catch (e) {
      setError("Could not load permissions: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(""), 3000); }

  async function toggle(role, perm, currentlyOn) {
    const k = keyOf(role, perm);
    setBusy(k); setError("");
    try {
      const headers = await authHeaders();
      let res;
      if (currentlyOn) {
        res = await fetch(`${SUPABASE_URL}/rest/v1/role_permissions?role=eq.${role}&permission=eq.${perm}`, { method: "DELETE", headers });
      } else {
        res = await fetch(`${SUPABASE_URL}/rest/v1/role_permissions`, {
          method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ role, permission: perm }),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      setGranted(prev => {
        const next = new Set(prev);
        if (currentlyOn) next.delete(k); else next.add(k);
        return next;
      });
      flash("Saved.");
    } catch (e) {
      setError("Could not save (superadmin only): " + e.message);
    } finally { setBusy(null); }
  }

  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24, boxShadow: "0 4px 20px rgba(15,23,42,0.04)", maxWidth: 720 };
  const th = { textAlign: "center", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 };
  const cell = { textAlign: "center", padding: "12px", borderTop: `1px solid ${C.border}` };

  function Cell({ role, perm }) {
    const on = granted.has(keyOf(role, perm));
    const k = keyOf(role, perm);
    return (
      <td style={cell}>
        <button onClick={() => toggle(role, perm, on)} disabled={busy === k}
          title={on ? "Granted — click to revoke" : "Not granted — click to grant"}
          style={{
            width: 26, height: 26, borderRadius: 6, cursor: busy === k ? "wait" : "pointer",
            border: `2px solid ${on ? C.success : C.border}`, background: on ? C.success : C.card,
            color: "#fff", fontSize: 15, fontWeight: 800, lineHeight: 1,
          }}>{on ? "✓" : ""}</button>
      </td>
    );
  }

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Roles &amp; Permissions</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Choose what each role can do. Super Admin always has every permission.</div>
        </div>
        <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
      </div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, margin: "12px 0" }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, margin: "12px 0" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ ...th, textAlign: "left" }}>Capability</th>
                <th style={th}>Super Admin</th>
                {ROLES.map(([, label]) => <th key={label} style={th}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(([perm, label]) => (
                <tr key={perm}>
                  <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{label}</td>
                  <td style={cell}>
                    <span title="Super Admin always has every permission"
                      style={{ display: "inline-flex", width: 26, height: 26, borderRadius: 6, border: `2px solid ${C.textLight}`, background: C.textLight, color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>✓</span>
                  </td>
                  {ROLES.map(([role]) => <Cell key={role} role={role} perm={perm} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: C.textLight, marginTop: 14, lineHeight: 1.5 }}>
        Changes take effect the next time a user signs in. “Manage user accounts” also controls who can open the Users tab and create/reset staff.
      </div>
    </div>
  );
}
