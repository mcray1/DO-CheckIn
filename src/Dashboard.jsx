import { useState, useEffect, useRef } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";

const C = {
  primary: "#1e40af", primaryLight: "#3b82f6", primaryBg: "#dbeafe",
  bg: "#f1f5f9", card: "#ffffff", text: "#1e293b",
  textMuted: "#64748b", textLight: "#94a3b8", border: "#e2e8f0",
  success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
};

const STATUS_OPTIONS = ["Excused", "Unexcused", "Admit Temporarily"];
const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning };

function today() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchSlips() {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips?order=created_at.desc&limit=500`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function updateSlip(id, patch) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Invokes the notify-teacher Edge Function to email the teacher. Non-fatal:
// the slip is already saved before this runs, so a notification failure never
// blocks the confirmation — it is only reported back to the officer.
async function notifyTeacher(slipId, senderEmail, senderName) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-teacher`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slipId, senderEmail, senderName }),
  });
  let payload = {};
  try { payload = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(payload.error || payload.detail || `HTTP ${res.status}`);
  return payload; // { status: "sent" | "skipped", ... }
}

export default function Dashboard({ profile, onSignOut }) {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("table"); // table | card
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterNature, setFilterNature] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedSlip, setSelectedSlip] = useState(null); // for confirm modal
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null); // { kind: "ok" | "warn", text }

  async function loadSlips() {
    setLoading(true); setError("");
    try {
      const data = await fetchSlips();
      setSlips(data);
    } catch (e) {
      setError("Could not load slips: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSlips(); }, []);

  const todayStr = today();
  const natures = [...new Set(slips.flatMap(s => s.nature || []))];

  const filtered = slips.filter(s => {
    if (filterStatus === "Pending" && s.status) return false;
    if (filterStatus !== "All" && filterStatus !== "Pending" && s.status !== filterStatus) return false;
    if (filterNature !== "All" && !(s.nature || []).includes(filterNature)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(s.name || "").toLowerCase().includes(q) && !(s.student_id || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stats = {
    today: slips.filter(s => s.date === todayStr).length,
    pending: slips.filter(s => !s.status).length,
    excused: slips.filter(s => s.status === "Excused").length,
    unexcused: slips.filter(s => s.status === "Unexcused").length,
    admit: slips.filter(s => s.status === "Admit Temporarily").length,
    total: slips.length,
  };

  const s = {
    root: { minHeight: "100vh", background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text },
    header: { background: C.card, borderBottom: `2px solid ${C.primary}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
    badge: { background: C.primary, color: "#fff", fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 4, letterSpacing: 1 },
    main: { maxWidth: 1200, margin: "0 auto", padding: "24px 20px" },
    statCard: (color) => ({ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${color}`, borderRadius: 10, padding: "14px 18px", flex: "1 1 100px", minWidth: 100 }),
    panel: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" },
    chip: (active) => ({ background: active ? C.primary : C.bg, color: active ? "#fff" : C.textMuted, border: `1px solid ${active ? C.primary : C.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }),
    th: { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" },
    td: { padding: "12px", borderBottom: `1px solid ${C.border}`, fontSize: 13 },
  };

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={s.badge}>POD</span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>POD Dashboard</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{profile?.full_name || profile?.email}</div>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{profile?.role}</div>
          </div>
          <button onClick={onSignOut} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>

      <div style={s.main}>
        {/* Notification result banner */}
        {notice && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            background: notice.kind === "ok" ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.12)",
            border: `1px solid ${notice.kind === "ok" ? C.success : C.warning}`,
            color: notice.kind === "ok" ? "#065f46" : "#92400e",
            borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16,
          }}>
            <span>{notice.kind === "ok" ? "✅ " : "⚠️ "}{notice.text}</span>
            <button onClick={() => setNotice(null)} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", color: "inherit", lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={s.statCard(C.primary)}><div style={{ fontSize: 26, fontWeight: 800, color: C.primary }}>{stats.today}</div><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Today</div></div>
          <div style={s.statCard(C.warning)}><div style={{ fontSize: 26, fontWeight: 800, color: C.warning }}>{stats.pending}</div><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Pending</div></div>
          <div style={s.statCard(C.success)}><div style={{ fontSize: 26, fontWeight: 800, color: C.success }}>{stats.excused}</div><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Excused</div></div>
          <div style={s.statCard(C.danger)}><div style={{ fontSize: 26, fontWeight: 800, color: C.danger }}>{stats.unexcused}</div><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Unexcused</div></div>
          <div style={s.statCard(C.textMuted)}><div style={{ fontSize: 26, fontWeight: 800, color: C.text }}>{stats.total}</div><div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>Total</div></div>
        </div>

        {/* Controls */}
        <div style={s.panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Admission Slips</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or ID..."
                style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 13, outline: "none", width: 180 }} />
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
                <button onClick={() => setViewMode("table")} style={{ background: viewMode === "table" ? C.primary : C.card, color: viewMode === "table" ? "#fff" : C.textMuted, border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Table</button>
                <button onClick={() => setViewMode("card")} style={{ background: viewMode === "card" ? C.primary : C.card, color: viewMode === "card" ? "#fff" : C.textMuted, border: "none", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cards</button>
              </div>
              <button onClick={loadSlips} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 700 }}>Status:</span>
            {["All", "Pending", ...STATUS_OPTIONS].map(f => (
              <button key={f} onClick={() => setFilterStatus(f)} style={s.chip(filterStatus === f)}>{f}</button>
            ))}
            {natures.length > 0 && <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 700, marginLeft: 8 }}>Nature:</span>}
            {["All", ...natures].map(f => (
              <button key={f} onClick={() => setFilterNature(f)} style={s.chip(filterNature === f)}>{f}</button>
            ))}
          </div>

          {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>{error}</div>}

          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading slips...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No slips match the current filters.</div>
          ) : viewMode === "table" ? (
            <TableView slips={filtered} onOpen={setSelectedSlip} />
          ) : (
            <CardView slips={filtered} onOpen={setSelectedSlip} />
          )}
        </div>
      </div>

      {/* Confirm Modal */}
      {selectedSlip && (
        <ConfirmModal slip={selectedSlip} profile={profile}
          onClose={() => setSelectedSlip(null)}
          onSaved={(updated, notif) => {
            setSlips(prev => prev.map(sl => sl.id === updated.id ? updated : sl));
            setSelectedSlip(null);
            if (notif) setNotice(notif);
          }} />
      )}
    </div>
  );
}

function StatusPill({ status }) {
  if (!status) return <span style={{ fontSize: 11, color: C.textLight, fontWeight: 600 }}>Pending</span>;
  const color = statusColors[status] || C.textMuted;
  return <span style={{ background: `${color}18`, color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{status}</span>;
}

function TableView({ slips, onOpen }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.bg }}>
            {["Time", "Date", "Name", "Gr. & Sec.", "Nature", "Reason", "Suggested", "Status", ""].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slips.map(sl => (
            <tr key={sl.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "12px", color: C.primary, fontWeight: 700, whiteSpace: "nowrap" }}>{sl.time_arrived}</td>
              <td style={{ padding: "12px", color: C.textMuted, whiteSpace: "nowrap" }}>{sl.date}</td>
              <td style={{ padding: "12px", fontWeight: 600, whiteSpace: "nowrap" }}>{sl.name}</td>
              <td style={{ padding: "12px", color: C.textMuted, whiteSpace: "nowrap" }}>{sl.grade_section}</td>
              <td style={{ padding: "12px" }}>
                {(sl.nature || []).map(n => <span key={n} style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, marginRight: 4 }}>{n}</span>)}
              </td>
              <td style={{ padding: "12px", color: C.textMuted, fontStyle: "italic", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sl.reason || "—"}</td>
              <td style={{ padding: "12px", fontSize: 12, color: C.textMuted }}>{sl.ai_sub_category ? `${sl.ai_sub_category} · ${sl.ai_status}` : "—"}</td>
              <td style={{ padding: "12px" }}><StatusPill status={sl.status} /></td>
              <td style={{ padding: "12px" }}>
                <button onClick={() => onOpen(sl)} style={{ background: sl.status ? C.bg : C.primary, color: sl.status ? C.textMuted : "#fff", border: sl.status ? `1px solid ${C.border}` : "none", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {sl.status ? "Review" : "Confirm"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardView({ slips, onOpen }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {slips.map(sl => (
        <div key={sl.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: C.card, borderLeft: `4px solid ${sl.status ? (statusColors[sl.status] || C.textMuted) : C.warning}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{sl.name}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{sl.student_id} · {sl.grade_section}</div>
            </div>
            <StatusPill status={sl.status} />
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {(sl.nature || []).map(n => <span key={n} style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{n}</span>)}
            <span style={{ fontSize: 12, color: C.textMuted }}>{sl.time_arrived} · {sl.date}</span>
          </div>
          {sl.reason && <div style={{ fontSize: 13, color: C.textMuted, fontStyle: "italic", marginBottom: 8, lineHeight: 1.4 }}>"{sl.reason}"</div>}
          {sl.ai_sub_category && <div style={{ fontSize: 12, color: C.textLight, marginBottom: 10 }}>🤖 Suggested: {sl.ai_sub_category} · {sl.ai_status}</div>}
          <button onClick={() => onOpen(sl)} style={{ width: "100%", background: sl.status ? C.bg : C.primary, color: sl.status ? C.textMuted : "#fff", border: sl.status ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {sl.status ? "Review / Edit" : "Confirm Slip"}
          </button>
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ slip, profile, onClose, onSaved }) {
  const [subCategory, setSubCategory] = useState(slip.final_sub_category || slip.ai_sub_category || "");
  const [status, setStatus] = useState(slip.status || slip.ai_status || "");
  const [docStatus, setDocStatus] = useState(slip.document_status || "Not Required");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleConfirm() {
    if (!status) { setErr("Please select a final status."); return; }
    setSaving(true); setErr("");
    try {
      const patch = {
        final_sub_category: subCategory || null,
        status,
        document_status: docStatus,
        confirmed_by: profile?.full_name || profile?.email,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const [updated] = await updateSlip(slip.id, patch);

      // Slip is saved. Attempt the teacher email notification — never block on it.
      let notif = null;
      try {
        const r = await notifyTeacher(slip.id, profile?.email, profile?.full_name);
        if (r.status === "sent") {
          updated.notification_sent = true;
          updated.notification_sent_at = new Date().toISOString();
          notif = { kind: "ok", text: `Slip confirmed. Teacher notified by email (${r.to}).` };
        } else {
          notif = { kind: "warn", text: `Slip confirmed, but email skipped: ${r.reason || "no teacher on file"}.` };
        }
      } catch (ne) {
        notif = { kind: "warn", text: `Slip confirmed, but the email did not send: ${ne.message}` };
      }
      onSaved(updated, notif);
    } catch (e) {
      setErr("Could not save: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: C.card, borderRadius: 14, padding: "28px 32px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{slip.name}</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>{slip.student_id} · {slip.grade_section}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: C.textLight, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: C.bg, borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
          <div style={{ marginBottom: 6 }}><strong>Nature:</strong> {(slip.nature || []).join(", ")} {slip.meridiem ? `(${slip.meridiem})` : ""}</div>
          <div style={{ marginBottom: 6 }}><strong>Time:</strong> {slip.time_arrived} · {slip.date}</div>
          {slip.teacher_name && <div style={{ marginBottom: 6 }}><strong>Teacher:</strong> {slip.teacher_name}</div>}
          {slip.reason && <div><strong>Reason:</strong> <span style={{ fontStyle: "italic", color: C.textMuted }}>"{slip.reason}"</span></div>}
        </div>

        {slip.ai_sub_category && (
          <div style={{ background: `${statusColors[slip.ai_status] || C.textMuted}12`, border: `1px solid ${statusColors[slip.ai_status] || C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 2 }}>🤖 SYSTEM SUGGESTION</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: statusColors[slip.ai_status] || C.text }}>{slip.ai_sub_category} · {slip.ai_status}</div>
          </div>
        )}

        {/* Sub-category */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>Sub-category</label>
          <input value={subCategory} onChange={e => setSubCategory(e.target.value)} placeholder="e.g. Transportation"
            style={{ width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Final Status */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>Final Status</label>
          <div style={{ display: "flex", gap: 8 }}>
            {STATUS_OPTIONS.map(st => (
              <button key={st} onClick={() => setStatus(st)} style={{ flex: 1, padding: "10px", border: `2px solid ${status === st ? statusColors[st] : C.border}`, background: status === st ? `${statusColors[st]}12` : C.card, color: status === st ? statusColors[st] : C.textMuted, borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                {st === "Admit Temporarily" ? "Admit Temp." : st}
              </button>
            ))}
          </div>
        </div>

        {/* Document tracking (if required) */}
        {slip.document_required && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>Document Status</label>
            <div style={{ fontSize: 12, color: C.warning, marginBottom: 6 }}>📄 Required: {slip.document_description} {slip.document_deadline ? `(by ${slip.document_deadline})` : ""}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Promised", "Received"].map(ds => (
                <button key={ds} onClick={() => setDocStatus(ds)} style={{ flex: 1, padding: "9px", border: `2px solid ${docStatus === ds ? C.primary : C.border}`, background: docStatus === ds ? C.primaryBg : C.card, color: docStatus === ds ? C.primary : C.textMuted, borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{ds}</button>
              ))}
            </div>
          </div>
        )}

        {err && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>{err}</div>}

        <div style={{ background: C.primaryBg, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: C.text, marginBottom: 16 }}>
          ℹ️ Confirming emails the teacher{slip.teacher_email ? ` (${slip.teacher_email})` : ""} from your account.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving} style={{ flex: 2, background: saving ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Saving..." : slip.status ? "Update Slip" : "Confirm Slip"}
          </button>
        </div>
      </div>
    </div>
  );
}
