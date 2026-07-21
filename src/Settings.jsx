import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";


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
  const [startMonth, setStartMonth] = useState(6);
  const [emailOn, setEmailOn] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [countWeekends, setCountWeekends] = useState(false);
  const [savingWeekends, setSavingWeekends] = useState(false);
  const [maintenanceOn, setMaintenanceOn] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [savingStartMonth, setSavingStartMonth] = useState(false);
  const [savingMaint, setSavingMaint] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=key,value`, { headers });
      const rows = res.ok ? await res.json() : [];
      const map = {};
      for (const r of rows) map[r.key] = r.value;
      if (map.repeat_offender_threshold != null) setThreshold(Number(map.repeat_offender_threshold) || 3);
      if (map.school_year_start_month != null) setStartMonth(Number(map.school_year_start_month) || 6);
      setEmailOn(map.email_notifications_enabled !== false);
      setCountWeekends(map.count_weekends === true);
      setMaintenanceOn(map.maintenance_mode === true);
      setMaintenanceMsg(typeof map.maintenance_message === "string" ? map.maintenance_message : "");
    } catch (e) {
      setError("Could not load settings: " + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function saveSetting(key, value) {
    const headers = await authHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.${key}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(""), 3500); }

  async function saveThreshold() {
    const val = Math.max(1, Math.floor(Number(threshold) || 1));
    setSavingThreshold(true); setError("");
    try {
      await saveSetting("repeat_offender_threshold", val);
      setThreshold(val);
      flash("Threshold saved.");
      if (onChanged) onChanged();
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSavingThreshold(false);
    }
  }

  async function saveStartMonth(val) {
    setSavingStartMonth(true); setError("");
    try {
      await saveSetting("school_year_start_month", val);
      setStartMonth(val);
      flash("School-year start month saved. Repeat-offender counts now reset from this month.");
      if (onChanged) onChanged();
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSavingStartMonth(false);
    }
  }

  async function saveEmail(nextOn) {
    setSavingEmail(true); setError("");
    try {
      await saveSetting("email_notifications_enabled", nextOn);
      setEmailOn(nextOn);
      flash(nextOn ? "Adviser emails are ON." : "Adviser emails are OFF — slips still confirm, no email is sent.");
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function saveWeekends(nextOn) {
    setSavingWeekends(true); setError("");
    try {
      await saveSetting("count_weekends", nextOn);
      setCountWeekends(nextOn);
      flash(nextOn ? "Weekends now count toward absence totals." : "Weekends are excluded from absence totals.");
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSavingWeekends(false);
    }
  }

  async function saveMaintenance(nextOn) {
    setSavingMaint(true); setError("");
    try {
      await saveSetting("maintenance_mode", nextOn);
      await saveSetting("maintenance_message", maintenanceMsg);
      setMaintenanceOn(nextOn);
      flash(nextOn ? "Maintenance mode ON — the kiosk is now closed to students." : "Maintenance mode OFF — the kiosk is live.");
    } catch (e) {
      setError("Could not save (admins only): " + e.message);
    } finally {
      setSavingMaint(false);
    }
  }

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 24, boxShadow: "0 4px 20px rgba(15,23,42,0.04)", maxWidth: 560 };
  const label = { fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" };
  const section = { borderTop: `1px solid ${C.border}`, paddingTop: 18, marginTop: 18 };

  return (
    <div style={panel}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Settings</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4 }}>System configuration (admin only).</div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, marginTop: 14 }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginTop: 14 }}>{error}</div>}

      {/* Repeat-offender threshold */}
      <div style={section}>
        <label style={label}>Repeat-offender threshold</label>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          A student is flagged as a repeat offender when they reach this many slips in <strong>any single category</strong> (e.g. {loading ? 3 : threshold}+ Late, or {loading ? 3 : threshold}+ Uniform).
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="number" min={1} value={threshold} disabled={loading}
            onChange={e => setThreshold(e.target.value)}
            style={{ width: 90, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
          <button onClick={saveThreshold} disabled={savingThreshold || loading}
            style={{ background: savingThreshold ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: savingThreshold || loading ? "not-allowed" : "pointer" }}>
            {savingThreshold ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* School-year start month */}
      <div style={section}>
        <label style={label}>School-year start month</label>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          The month your school year begins. Repeat-offender counts reset at the start of each school year, so a student flagged last year starts fresh.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={startMonth} disabled={loading}
            onChange={e => saveStartMonth(Number(e.target.value))}
            style={{ width: 180, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 15, outline: "none", boxSizing: "border-box", background: C.card, cursor: savingStartMonth || loading ? "not-allowed" : "pointer" }}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          {savingStartMonth && <span style={{ fontSize: 13, color: C.textMuted }}>Saving...</span>}
        </div>
      </div>

      {/* Weekend counting for absences */}
      <div style={section}>
        <label style={label}>Count weekends in absences</label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            When OFF (default), Saturdays and Sundays are not counted in an absence's day total. The POD can still override the number on any slip.
          </div>
          <button onClick={() => saveWeekends(!countWeekends)} disabled={savingWeekends || loading}
            style={{ flexShrink: 0, background: countWeekends ? C.success : C.bg, color: countWeekends ? "#fff" : C.textMuted, border: `1px solid ${countWeekends ? C.success : C.border}`, borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: savingWeekends || loading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {savingWeekends ? "Saving..." : countWeekends ? "● ON — counting" : "○ OFF — excluded"}
          </button>
        </div>
      </div>

      {/* Adviser email notifications */}
      <div style={section}>
        <label style={label}>Adviser email notifications</label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            When ON, confirming a slip emails the student's adviser. When OFF, slips still confirm normally — no email is sent and nothing is queued.
          </div>
          <button onClick={() => saveEmail(!emailOn)} disabled={savingEmail || loading}
            style={{ flexShrink: 0, background: emailOn ? C.success : C.bg, color: emailOn ? "#fff" : C.textMuted, border: `1px solid ${emailOn ? C.success : C.border}`, borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: savingEmail || loading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {savingEmail ? "Saving..." : emailOn ? "● ON — Turn Off" : "○ OFF — Turn On"}
          </button>
        </div>
      </div>

      {/* Maintenance mode */}
      <div style={section}>
        <label style={label}>Maintenance mode</label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            When ON, the public kiosk is closed to students and shows the message below. Staff can still log in.
          </div>
          <button onClick={() => saveMaintenance(!maintenanceOn)} disabled={savingMaint || loading}
            style={{ flexShrink: 0, background: maintenanceOn ? C.danger : C.bg, color: maintenanceOn ? "#fff" : C.textMuted, border: `1px solid ${maintenanceOn ? C.danger : C.border}`, borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: savingMaint || loading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {savingMaint ? "Saving..." : maintenanceOn ? "● ON — Turn Off" : "○ OFF — Turn On"}
          </button>
        </div>
        <label style={label}>Kiosk message</label>
        <textarea value={maintenanceMsg} disabled={loading} onChange={e => setMaintenanceMsg(e.target.value)} rows={2}
          placeholder="Message shown to students while the kiosk is closed"
          style={{ width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={() => saveMaintenance(maintenanceOn)} disabled={savingMaint || loading}
            style={{ background: "transparent", color: C.primary, border: `1px solid ${C.primary}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: savingMaint || loading ? "not-allowed" : "pointer" }}>
            Save message
          </button>
        </div>
      </div>
    </div>
  );
}
