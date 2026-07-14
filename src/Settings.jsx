import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";

const C = {
  primary: "#1e40af", primaryBg: "#dbeafe",
  bg: "#f1f5f9", card: "#ffffff", text: "#1e293b",
  textMuted: "#64748b", textLight: "#94a3b8", border: "#e2e8f0",
  success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

// Admin-only settings. onChanged() lets the dashboard re-run repeat-offender
// flagging after the threshold is saved.
export default function Settings({ onChanged }) {
  const [threshold, setThreshold] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.repeat_offender_threshold&select=value`, { headers });
      const data = res.ok ? await res.json() : [];
      setThreshold(Number(data?.[0]?.value ?? 3) || 3);
    } catch (e) {
      setError("Could not load settings: " + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const val = Math.max(1, Math.floor(Number(threshold) || 1));
    setSaving(true); setError(""); setNotice("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.repeat_offender_threshold`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ value: val, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setThreshold(val);
      setNotice("Saved.");
      setTimeout(() => setNotice(""), 3000);
      if (onChanged) onChanged();
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSaving(false);
    }
  }

  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24, boxShadow: "0 4px 20px rgba(15,23,42,0.04)", maxWidth: 560 };
  const label = { fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" };

  return (
    <div style={panel}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Settings</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 20 }}>System configuration (admin only).</div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, marginBottom: 14 }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 14 }}>{error}</div>}

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
        <label style={label}>Repeat-offender threshold</label>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          A student is flagged as a repeat offender when they reach this many slips in <strong>any single category</strong> (e.g. {loading ? 3 : threshold}+ Late, or {loading ? 3 : threshold}+ Uniform).
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="number" min={1} value={threshold} disabled={loading}
            onChange={e => setThreshold(e.target.value)}
            style={{ width: 90, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
          <button onClick={save} disabled={saving || loading}
            style={{ background: saving ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: saving || loading ? "not-allowed" : "pointer" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
