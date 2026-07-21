import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";

// Reports (view_reports permission). Two modes over a date window:
//  • Summary       — counts by category / grade level / section, by status.
//  • Monitoring    — the POD's Admission Slip Monitoring Sheet: one row per slip
//                    with the lateness/absences reason tally, scoped to all,
//                    a grade level, or a section. CSV export.
//
// Slips are bucketed by their `date` label (local PH date the kiosk stamped),
// not created_at (stored UTC), so day boundaries match what the POD sees.

const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning, Pending: C.textMuted };
const STATUS_COLS = [
  ["Excused", "Excused"],
  ["Unexcused", "Unexcused"],
  ["Admit Temporarily", "Admit Temp."],
  ["Pending", "Pending"],
];
// The POD's six reason columns, tallied under a lateness and an absences band.
const REASON_COLS = ["health", "traffic", "OSR", "travel", "woke up late", "fam matters"];
function reasonKey(sub) {
  const s = (sub || "").toLowerCase();
  if (s.includes("health")) return "health";
  if (s.includes("traffic")) return "traffic";
  if (s.includes("osr")) return "OSR";
  if (s.includes("travel")) return "travel";
  if (s.includes("woke")) return "woke up late";
  if (s.includes("fam")) return "fam matters"; // Family Matters
  return null;
}

const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const prettyDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
function fmtISO(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function countDays(a, b) {
  if (!a) return 0;
  const p = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  return Math.round((p(b || a) - p(a)) / 86400000) + 1;
}
function absenceRange(a, b) {
  if (!a) return "";
  return (!b || b === a) ? fmtISO(a) : `${fmtISO(a)} – ${fmtISO(b)}`;
}

function slipDay(s) {
  const t = Date.parse(s.date);
  if (!Number.isNaN(t)) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (s.created_at) { const d = new Date(s.created_at); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return null;
}
function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const levelOf = (gs) => (gs || "").trim() ? (gs.split(" - ")[0].trim()) : "";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
}

function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCSV(name, matrix) {
  const csv = matrix.map(r => r.map(csvEscape).join(",")).join("\r\n");
  // Lead with a UTF-8 BOM so Excel reads en-dashes, middot and ✓ correctly
  // instead of mangling them (it defaults to Windows-1252 for CSV).
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// Excel sheet names: <=31 chars, none of []:*?/\, and unique.
function sheetName(raw, used) {
  let n = String(raw || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let base = n, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

export default function Reports() {
  const [mode, setMode] = useState("summary"); // summary | monitoring
  const [period, setPeriod] = useState("today"); // today | week | month | custom
  const today = midnight(new Date());
  const [from, setFrom] = useState(isoDate(today));
  const [to, setTo] = useState(isoDate(today));
  const [groupBy, setGroupBy] = useState("category"); // summary
  const [scopeType, setScopeType] = useState("all"); // monitoring: all | level | section
  const [scopeValue, setScopeValue] = useState("");
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [xlsxBusy, setXlsxBusy] = useState(false);

  function windowRange() {
    const now = midnight(new Date());
    if (period === "today") return [now, now];
    if (period === "week") { const m = new Date(now); m.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return [m, now]; }
    if (period === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), now];
    const f = from ? new Date(from + "T00:00:00") : now;
    const t = to ? new Date(to + "T00:00:00") : now;
    return [midnight(f), midnight(t)];
  }
  const [winFrom, winTo] = windowRange();

  async function load() {
    setLoading(true); setError("");
    try {
      const lo = new Date(winFrom); lo.setDate(lo.getDate() - 2);
      const hi = new Date(winTo); hi.setDate(hi.getDate() + 2);
      const headers = await authHeaders();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admission_slips?select=id,date,created_at,name,student_id,grade_section,nature,status,` +
        `time_arrived,meridiem,reason,final_sub_category,ai_sub_category,absence_date,absence_end_date` +
        `&created_at=gte.${isoDate(lo)}&created_at=lte.${isoDate(hi)}T23:59:59&order=created_at&limit=20000`,
        { headers });
      if (!res.ok) throw new Error(await res.text());
      setSlips(await res.json());
    } catch (e) {
      setError("Could not load report: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period, from, to]);

  const fromMs = winFrom.getTime(), toMs = winTo.getTime();
  const inWindow = slips.filter(s => { const d = slipDay(s); return d != null && d >= fromMs && d <= toMs; });
  const rangeText = `${prettyDate(winFrom)}${fromMs !== toMs ? " – " + prettyDate(winTo) : ""}`;
  const periodLabel = period === "today" ? "Daily" : period === "week" ? "Weekly" : period === "month" ? "Monthly" : "Custom";

  // ── shared period + toggle UI ────────────────────────────────────
  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" };
  const seg = (active) => ({ background: active ? C.primary : C.card, color: active ? "#fff" : C.textMuted, border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" };
  const num = { textAlign: "right", padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const segRow = (label, opts, val, setVal) => (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
        {opts.map(([id, l]) => <button key={id} onClick={() => setVal(id)} style={seg(val === id)}>{l}</button>)}
      </div>
    </div>
  );

  // ── SUMMARY aggregation ──────────────────────────────────────────
  function keysFor(s) {
    if (groupBy === "category") return (s.nature && s.nature.length ? s.nature : ["(uncategorised)"]);
    if (groupBy === "level") return [levelOf(s.grade_section) || "(no level)"];
    return [(s.grade_section || "").trim() || "(no section)"];
  }
  const groups = {};
  for (const s of inWindow) {
    const b = s.status || "Pending";
    for (const k of keysFor(s)) {
      if (!groups[k]) groups[k] = { Excused: 0, Unexcused: 0, "Admit Temporarily": 0, Pending: 0, total: 0 };
      groups[k][b]++; groups[k].total++;
    }
  }
  const sumRows = Object.entries(groups).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const totals = STATUS_COLS.reduce((acc, [st]) => { acc[st] = sumRows.reduce((n, r) => n + r[st], 0); return acc; }, {});
  totals.total = sumRows.reduce((n, r) => n + r.total, 0);
  const groupLabel = groupBy === "category" ? "Category" : groupBy === "level" ? "Grade Level" : "Section";

  function exportSummary() {
    const head = [groupLabel, ...STATUS_COLS.map(([, l]) => l), "Total"];
    const body = sumRows.map(r => [r.key, ...STATUS_COLS.map(([st]) => r[st]), r.total]);
    body.push(["TOTAL", ...STATUS_COLS.map(([st]) => totals[st]), totals.total]);
    downloadCSV(`report-${period}-by-${groupBy}-${isoDate(winFrom)}.csv`,
      [[`ADI-SMCS Discipline Office — ${periodLabel} report by ${groupLabel}`], [rangeText], [], head, ...body]);
  }

  // ── MONITORING SHEET ─────────────────────────────────────────────
  const levels = [...new Set(inWindow.map(s => levelOf(s.grade_section)).filter(Boolean))].sort();
  const sections = [...new Set(inWindow.map(s => (s.grade_section || "").trim()).filter(Boolean))].sort();
  const scoped = inWindow.filter(s => {
    if (scopeType === "level") return levelOf(s.grade_section) === scopeValue;
    if (scopeType === "section") return (s.grade_section || "").trim() === scopeValue;
    return true;
  }).sort((a, b) => (a.grade_section || "").localeCompare(b.grade_section || "") || (a.name || "").localeCompare(b.name || ""));

  function monitoringRow(s) {
    const nat = s.nature || [];
    const isLate = nat.includes("Late"), isAbsent = nat.includes("Absent"), isUniform = nat.includes("Uniform");
    const sub = s.final_sub_category || s.ai_sub_category || "";
    const rk = reasonKey(sub);
    const lateCols = REASON_COLS.map(c => (isLate && rk === c) ? "1" : "");
    const absCols = REASON_COLS.map(c => (isAbsent && rk === c) ? "1" : "");
    return {
      name: s.name || "", section: s.grade_section || "", date: s.date || "",
      daysCovered: s.absence_date ? absenceRange(s.absence_date, s.absence_end_date) : "",
      absences: isAbsent ? (s.absence_date ? countDays(s.absence_date, s.absence_end_date) : "✓") : "",
      tardiness: isLate ? "✓" : "",
      time: isLate ? [s.time_arrived, s.meridiem].filter(Boolean).join(" ") : (s.time_arrived || ""),
      uniform: isUniform ? "✓" : "",
      status: s.status || "", reasons: s.reason || sub || "",
      lateCols, absCols,
    };
  }
  const monRows = scoped.map(monitoringRow);
  const scopeLabel = scopeType === "all" ? "All sections" : scopeType === "level" ? (scopeValue || "—") : (scopeValue || "—");

  function exportMonitoring() {
    const flatHead = ["NAME OF STUDENT", "YEAR & SECTION", "DATE FILED", "DAYS COVERED", "ABSENCES", "TARDINESS", "TIME", "UNIFORM", "STATUS", "REASONS"];
    const bandRow = [...Array(10).fill(""), "lateness", "", "", "", "", "", "absences", "", "", "", "", ""];
    const header = [...flatHead, ...REASON_COLS, ...REASON_COLS];
    const body = monRows.map(r => [
      r.name, r.section, r.date, r.daysCovered, r.absences, r.tardiness, r.time, r.uniform, r.status, r.reasons,
      ...r.lateCols, ...r.absCols,
    ]);
    const tag = scopeType === "all" ? "all" : (scopeValue || "scope").replace(/[^a-z0-9]+/gi, "-");
    downloadCSV(`monitoring-sheet-${tag}-${isoDate(winFrom)}.csv`, [
      ["ATENEO DE ILOILO – SMCS · DISCIPLINE OFFICE"],
      ["Admission Slip Monitoring Sheet"],
      [`${scopeLabel} · ${rangeText}`],
      [],
      bandRow, header, ...body,
    ]);
  }

  const FLAT_HEAD = ["NAME OF STUDENT", "YEAR & SECTION", "DATE FILED", "DAYS COVERED", "ABSENCES", "TARDINESS", "TIME", "UNIFORM", "STATUS", "REASONS"];

  // One workbook, one worksheet per section (grouped from the scoped rows), laid
  // out like the paper sheet with merged title/band cells. xlsx is loaded on
  // demand so it never weighs down normal use.
  async function exportMonitoringExcel() {
    const XLSX = await import("xlsx");
    const bySection = {};
    for (const s of scoped) {
      const sec = (s.grade_section || "(no section)").trim() || "(no section)";
      (bySection[sec] ||= []).push(s);
    }
    const wb = XLSX.utils.book_new();
    const used = new Set();
    for (const sec of Object.keys(bySection).sort()) {
      const rows = bySection[sec];
      const aoa = [
        ["ATENEO DE ILOILO – SMCS · DISCIPLINE OFFICE"],
        ["Admission Slip Monitoring Sheet"],
        [`${sec} · ${rangeText}`],
        [],
        [...Array(10).fill(""), "lateness", "", "", "", "", "", "absences", "", "", "", "", ""],
        [...FLAT_HEAD, ...REASON_COLS, ...REASON_COLS],
      ];
      for (const s of rows) {
        const r = monitoringRow(s);
        // Reason tallies as real numbers so the school can SUM each column.
        const late = r.lateCols.map(v => v ? 1 : "");
        const abs = r.absCols.map(v => v ? 1 : "");
        aoa.push([r.name, r.section, r.date, r.daysCovered, r.absences, r.tardiness, r.time, r.uniform, r.status, r.reasons, ...late, ...abs]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 21 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 21 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 21 } },
        { s: { r: 4, c: 10 }, e: { r: 4, c: 15 } }, // lateness band
        { s: { r: 4, c: 16 }, e: { r: 4, c: 21 } }, // absences band
      ];
      ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 11 }, { wch: 18 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 24 },
        ...Array(12).fill({ wch: 6 })];
      XLSX.utils.book_append_sheet(wb, ws, sheetName(sec, used));
    }
    const tag = scopeType === "all" ? "all" : (scopeValue || "scope").replace(/[^a-z0-9]+/gi, "-");
    XLSX.writeFile(wb, `monitoring-sheet-${tag}-${isoDate(winFrom)}.xlsx`);
  }

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Reports</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Counts use each slip's filing date.</div>
        </div>
        <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
      </div>

      {segRow("Report", [["summary", "Summary"], ["monitoring", "Monitoring Sheet"]], mode, setMode)}

      {/* Period */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Period</span>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
          {[["today", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["custom", "Custom"]].map(([id, l]) => (
            <button key={id} onClick={() => setPeriod(id)} style={seg(period === id)}>{l}</button>
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

      {mode === "summary" ? (
        segRow("Break down by", [["category", "Category"], ["level", "Grade Level"], ["section", "Section"]], groupBy, setGroupBy)
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" }}>Scope</span>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
            {[["all", "All"], ["level", "Grade Level"], ["section", "Section"]].map(([id, l]) => (
              <button key={id} onClick={() => { setScopeType(id); setScopeValue(""); }} style={seg(scopeType === id)}>{l}</button>
            ))}
          </div>
          {scopeType === "level" && (
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 14 }}>
              <option value="">— choose grade level —</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {scopeType === "section" && (
            <select value={scopeValue} onChange={e => setScopeValue(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 14 }}>
              <option value="">— choose section —</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
        <div style={{ fontSize: 13, color: C.textMuted }}>
          {rangeText} · <strong style={{ color: C.text }}>{mode === "summary" ? totals.total : monRows.length}</strong> slip{(mode === "summary" ? totals.total : monRows.length) === 1 ? "" : "s"}
        </div>
        {mode === "summary" ? (
          <button onClick={exportSummary} disabled={sumRows.length === 0}
            style={{ background: sumRows.length ? C.primary : C.textLight, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: sumRows.length ? "pointer" : "not-allowed", fontWeight: 700 }}>⬇ Export CSV</button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={exportMonitoring} disabled={monRows.length === 0}
              style={{ background: C.card, color: monRows.length ? C.primary : C.textLight, border: `1px solid ${monRows.length ? C.primary : C.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: monRows.length ? "pointer" : "not-allowed", fontWeight: 700 }}>⬇ CSV</button>
            <button onClick={() => { setXlsxBusy(true); exportMonitoringExcel().catch(e => setError("Excel export failed: " + e.message)).finally(() => setXlsxBusy(false)); }}
              disabled={monRows.length === 0 || xlsxBusy}
              style={{ background: monRows.length && !xlsxBusy ? C.primary : C.textLight, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: monRows.length && !xlsxBusy ? "pointer" : "not-allowed", fontWeight: 700 }}>
              {xlsxBusy ? "Building…" : "⬇ Excel (tabs per section)"}
            </button>
          </div>
        )}
      </div>

      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginTop: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : mode === "summary" ? (
        sumRows.length === 0 ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No slips in this period.</div> : (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: C.bg }}>
                <th style={th}>{groupLabel}</th>
                {STATUS_COLS.map(([st, l]) => <th key={st} style={{ ...th, textAlign: "right" }}><span style={{ color: statusColors[st] }}>{l}</span></th>)}
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr></thead>
              <tbody>
                {sumRows.map(r => (
                  <tr key={r.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{r.key}</td>
                    {STATUS_COLS.map(([st]) => <td key={st} style={{ ...num, color: r[st] ? C.text : C.textLight }}>{r[st] || "—"}</td>)}
                    <td style={{ ...num, fontWeight: 800 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: C.bg, borderTop: `2px solid ${C.border}` }}>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800 }}>TOTAL</td>
                {STATUS_COLS.map(([st]) => <td key={st} style={{ ...num, fontWeight: 800 }}>{totals[st] || "—"}</td>)}
                <td style={{ ...num, fontWeight: 800 }}>{totals.total}</td>
              </tr></tfoot>
            </table>
          </div>
        )
      ) : (
        (scopeType !== "all" && !scopeValue) ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Choose a {scopeType === "level" ? "grade level" : "section"} above.</div>
        ) : monRows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No slips for this scope and period.</div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["Name", "Year & Sec.", "Date Filed", "Days Covered", "Absences", "Tardiness", "Time", "Uniform", "Status", "Reasons"].map(h => <th key={h} rowSpan={2} style={{ ...th, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}
                  <th colSpan={6} style={{ ...th, textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.warning }}>Lateness</th>
                  <th colSpan={6} style={{ ...th, textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.danger }}>Absences</th>
                </tr>
                <tr style={{ background: C.bg }}>
                  {REASON_COLS.map(c => <th key={"l" + c} style={{ ...th, textAlign: "center", fontSize: 10 }}>{c}</th>)}
                  {REASON_COLS.map(c => <th key={"a" + c} style={{ ...th, textAlign: "center", fontSize: 10 }}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {monRows.slice(0, 60).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "6px 10px", color: C.textMuted }}>{r.section}</td>
                    <td style={{ padding: "6px 10px" }}>{r.date}</td>
                    <td style={{ padding: "6px 10px" }}>{r.daysCovered}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{r.absences}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{r.tardiness}</td>
                    <td style={{ padding: "6px 10px" }}>{r.time}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{r.uniform}</td>
                    <td style={{ padding: "6px 10px" }}>{r.status}</td>
                    <td style={{ padding: "6px 10px", color: C.textMuted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.reasons}</td>
                    {r.lateCols.map((v, j) => <td key={"l" + j} style={{ padding: "6px", textAlign: "center", color: C.warning, fontWeight: 800 }}>{v && "✓"}</td>)}
                    {r.absCols.map((v, j) => <td key={"a" + j} style={{ padding: "6px", textAlign: "center", color: C.danger, fontWeight: 800 }}>{v && "✓"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {monRows.length > 60 && <div style={{ padding: "8px 12px", fontSize: 12, color: C.textLight, background: C.bg }}>Showing 60 of {monRows.length} rows — export the CSV for the full sheet.</div>}
          </div>
        )
      )}
    </div>
  );
}
