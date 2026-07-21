import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";

// Reports (view_reports permission). Counts admission slips over a period, broken
// down by category / grade level / section. Aggregation is client-side over the
// slips in the window — no DB views needed.
//
// Slips are bucketed by their `date` field (the local PH date the kiosk stamped),
// not created_at (stored UTC), so day boundaries match what the POD actually sees.

const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning, Pending: C.textMuted };
const STATUS_COLS = [
  ["Excused", "Excused"],
  ["Unexcused", "Unexcused"],
  ["Admit Temporarily", "Admit Temp."],
  ["Pending", "Pending"],
];

const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const prettyDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Local midnight epoch for a slip, from its date label; falls back to created_at.
function slipDay(s) {
  const t = Date.parse(s.date);
  if (!Number.isNaN(t)) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (s.created_at) { const d = new Date(s.created_at); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return null;
}
function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
}

export default function Reports() {
  const [period, setPeriod] = useState("today"); // today | week | month | custom
  const today = midnight(new Date());
  const [from, setFrom] = useState(isoDate(today));
  const [to, setTo] = useState(isoDate(today));
  const [groupBy, setGroupBy] = useState("category"); // category | level | section
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Resolve the active window from the chosen period.
  function windowRange() {
    const now = midnight(new Date());
    if (period === "today") return [now, now];
    if (period === "week") {
      const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return [monday, now];
    }
    if (period === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), now];
    // custom
    const f = from ? new Date(from + "T00:00:00") : now;
    const t = to ? new Date(to + "T00:00:00") : now;
    return [midnight(f), midnight(t)];
  }
  const [winFrom, winTo] = windowRange();

  async function load() {
    setLoading(true); setError("");
    try {
      // Coarse fetch by created_at with 2-day padding to cover any UTC/local skew,
      // then filter precisely by the local date label client-side.
      const lo = new Date(winFrom); lo.setDate(lo.getDate() - 2);
      const hi = new Date(winTo); hi.setDate(hi.getDate() + 2);
      const headers = await authHeaders();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admission_slips?select=id,date,created_at,grade_section,nature,status` +
        `&created_at=gte.${isoDate(lo)}&created_at=lte.${isoDate(hi)}T23:59:59&order=created_at&limit=20000`,
        { headers });
      if (!res.ok) throw new Error(await res.text());
      setSlips(await res.json());
    } catch (e) {
      setError("Could not load report: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period, from, to]);

  // Slips inside the exact window.
  const fromMs = winFrom.getTime(), toMs = winTo.getTime();
  const inWindow = slips.filter(s => { const d = slipDay(s); return d != null && d >= fromMs && d <= toMs; });

  // Group -> { status: count, total }.
  function keysFor(s) {
    if (groupBy === "category") return (s.nature && s.nature.length ? s.nature : ["(uncategorised)"]);
    const gs = (s.grade_section || "").trim();
    if (groupBy === "level") return [gs ? gs.split(" - ")[0].trim() : "(no level)"];
    return [gs || "(no section)"]; // section = the full class
  }
  const groups = {};
  for (const s of inWindow) {
    const bucket = s.status || "Pending";
    for (const k of keysFor(s)) {
      if (!groups[k]) groups[k] = { Excused: 0, Unexcused: 0, "Admit Temporarily": 0, Pending: 0, total: 0 };
      groups[k][bucket] = (groups[k][bucket] || 0) + 1;
      groups[k].total++;
    }
  }
  const rows = Object.entries(groups)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  const totals = STATUS_COLS.reduce((acc, [st]) => { acc[st] = rows.reduce((n, r) => n + r[st], 0); return acc; }, {});
  totals.total = rows.reduce((n, r) => n + r.total, 0);

  const groupLabel = groupBy === "category" ? "Category" : groupBy === "level" ? "Grade Level" : "Section";
  const periodLabel = period === "today" ? "Today"
    : period === "week" ? "This Week" : period === "month" ? "This Month" : "Custom";

  function exportCSV() {
    const head = [groupLabel, ...STATUS_COLS.map(([, l]) => l), "Total"];
    const body = rows.map(r => [r.key, ...STATUS_COLS.map(([st]) => r[st]), r.total]);
    body.push(["TOTAL", ...STATUS_COLS.map(([st]) => totals[st]), totals.total]);
    const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [
      [`ADI-SMCS Discipline Office — ${periodLabel} report by ${groupLabel}`],
      [`${prettyDate(winFrom)}${fromMs !== toMs ? " – " + prettyDate(winTo) : ""}`],
      [],
      head, ...body,
    ].map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report-${period}-by-${groupBy}-${isoDate(winFrom)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" };
  const seg = (active) => ({ background: active ? C.primary : C.card, color: active ? "#fff" : C.textMuted, border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" };
  const num = { textAlign: "right", padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Reports</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Admission slips by category, grade level or section. Counts use each slip's filing date.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
          <button onClick={exportCSV} disabled={rows.length === 0}
            style={{ background: rows.length ? C.primary : C.textLight, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: rows.length ? "pointer" : "not-allowed", fontWeight: 700 }}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Period */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Period</span>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
          {[["today", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["custom", "Custom"]].map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)} style={seg(period === id)}>{label}</button>
          ))}
        </div>
        {period === "custom" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.textMuted }}>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 14 }} />
            <span>to</span>
            <input type="date" value={to} min={from} max={isoDate(today)} onChange={e => setTo(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 14 }} />
          </div>
        )}
      </div>

      {/* Group by */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Break down by</span>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
          {[["category", "Category"], ["level", "Grade Level"], ["section", "Section"]].map(([id, label]) => (
            <button key={id} onClick={() => setGroupBy(id)} style={seg(groupBy === id)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 14 }}>
        {prettyDate(winFrom)}{fromMs !== toMs ? ` – ${prettyDate(winTo)}` : ""} · <strong style={{ color: C.text }}>{totals.total}</strong> slip{totals.total === 1 ? "" : "s"}
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginTop: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No slips in this period.</div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: C.bg }}>
              <th style={th}>{groupLabel}</th>
              {STATUS_COLS.map(([st, label]) => <th key={st} style={{ ...th, textAlign: "right" }}><span style={{ color: statusColors[st] }}>{label}</span></th>)}
              <th style={{ ...th, textAlign: "right" }}>Total</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{r.key}</td>
                  {STATUS_COLS.map(([st]) => <td key={st} style={{ ...num, color: r[st] ? C.text : C.textLight }}>{r[st] || "—"}</td>)}
                  <td style={{ ...num, fontWeight: 800 }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: C.bg, borderTop: `2px solid ${C.border}` }}>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800 }}>TOTAL</td>
                {STATUS_COLS.map(([st]) => <td key={st} style={{ ...num, fontWeight: 800 }}>{totals[st] || "—"}</td>)}
                <td style={{ ...num, fontWeight: 800 }}>{totals.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
