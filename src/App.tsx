import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://ghofeoxrkrcibzeqcbih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2Zlb3hya3JjaWJ6ZXFjYmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTI4MTIsImV4cCI6MjA5ODIyODgxMn0.RsFkrqiuv4CzXGRg2FP33nTj5dMUtD2aF8w5NQYtmKQ";

// Beadle Companion light theme palette
const C = {
  primary: "#1e40af",
  primaryLight: "#3b82f6",
  primaryBg: "#dbeafe",
  bg: "#f1f5f9",
  card: "#ffffff",
  text: "#1e293b",
  textMuted: "#64748b",
  textLight: "#94a3b8",
  border: "#e2e8f0",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
};

const NATURE_OPTIONS = ["Late","Uniform","Hairstyle","Gadget","Absent","POST","Suspension","Others"];
const STATUS_OPTIONS = ["Excused","Unexcused","Admit Temporarily"];

function getToday() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function getTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
function getMeridiem() {
  return new Date().getHours() < 12 ? "A.M." : "P.M.";
}
function Clock() {
  const [time, setTime] = useState(getTime());
  useEffect(() => { const id = setInterval(() => setTime(getTime()), 1000); return () => clearInterval(id); }, []);
  return <span>{time}</span>;
}

async function searchStudents(query) {
  if (!query || query.trim().length < 2) return [];
  const q = encodeURIComponent(query.trim());
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/students?or=(name.ilike.*${q}*,student_no.ilike.*${q}*)&select=name,student_no,level,section,rfid&limit=20`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return [];
  const all = await res.json();
  return all.slice(0, 8).map(r => ({
    name: r.name,
    student_id: r.student_no,
    grade_section: [r.level, r.section].filter(Boolean).join(" - "),
    rfid: r.rfid || "",
  }));
}

async function sbInsertSlip(slip) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: "return=representation" },
    body: JSON.stringify(slip),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbFetchSlips() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips?order=created_at.desc&limit=3000`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbUpdateStatus(id, status) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: "return=representation" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function StudentSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounce.current);
    if (val.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const r = await searchStudents(val);
      setResults(r);
      setLoading(false);
    }, 300);
  }

  return (
    <div style={{ position: "relative" }}>
      <input autoFocus value={query} onChange={handleChange} placeholder="Type name or Student ID..."
        style={{ width: "100%", background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", fontSize: 17, color: C.text, outline: "none", boxSizing: "border-box" }} />
      {(loading || results.length > 0 || (query.length >= 2 && !loading)) && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 10px 30px rgba(15,23,42,0.12)" }}>
          {loading && <div style={{ padding: "14px 16px", color: C.textMuted, fontSize: 14 }}>Searching...</div>}
          {!loading && results.map(s => (
            <div key={s.student_id} onClick={() => { onSelect(s); setQuery(""); setResults([]); }}
              style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onMouseEnter={e => e.currentTarget.style.background = C.primaryBg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div>
                <div style={{ fontWeight: 600, color: C.text }}>{s.name}</div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{s.grade_section}</div>
              </div>
              <span style={{ fontSize: 13, color: C.textMuted, fontFamily: "monospace" }}>{s.student_id}</span>
            </div>
          ))}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "14px 16px", color: C.textMuted, fontSize: 14 }}>No students found.</div>
          )}
        </div>
      )}
    </div>
  );
}

function SlipPreview({ slip, onDone }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: "32px 36px", width: "100%", maxWidth: 480, boxShadow: "0 10px 30px rgba(15,23,42,0.1)", color: C.text, border: `1px solid ${C.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 20, borderBottom: `2px solid ${C.primary}`, paddingBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.textMuted }}>ATENEO DE ILOILO – SMCS</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>DISCIPLINE OFFICE</div>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 2, color: C.primary }}>ADMISSION SLIP</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 16 }}>
        <Field label="Name" value={slip.name} span={true} />
        <Field label="Date" value={slip.date} />
        <Field label="Time Arrived" value={slip.time_arrived} />
        <Field label="Gr. & Sec." value={slip.grade_section} span={true} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: C.textMuted }}>NATURE:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {slip.nature.map(n => (
            <span key={n} style={{ background: C.primary, color: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{n}</span>
          ))}
        </div>
      </div>

      {slip.nature.includes("Late") && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted }}>IF LATE: </span>
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 8 }}>{slip.meridiem}</span>
        </div>
      )}

      {slip.reason && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: C.textMuted }}>REASON:</div>
          <div style={{ fontSize: 13, fontStyle: "italic", color: C.text, lineHeight: 1.5, background: C.bg, borderRadius: 6, padding: "10px 12px" }}>"{slip.reason}"</div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: C.textMuted }}>STATUS:</div>
        <div style={{ display: "flex", gap: 8 }}>
          {STATUS_OPTIONS.map(s => (
            <span key={s} style={{ borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700, background: slip.status === s ? C.primary : C.bg, color: slip.status === s ? "#fff" : C.textLight, border: `1px solid ${slip.status === s ? C.primary : C.border}` }}>{s}</span>
          ))}
        </div>
        {!slip.status && <div style={{ fontSize: 12, color: C.warning, marginTop: 6, fontWeight: 600 }}>⏳ Pending — POD officer will set status</div>}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginBottom: 16, fontSize: 11, color: C.textLight, textAlign: "center" }}>
        Signed: ________________________<br />
        <span style={{ fontWeight: 700 }}>Prefect of Discipline / Discipline Officer</span>
      </div>

      <button onClick={onDone} style={{ width: "100%", background: C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Next Student</button>
    </div>
  );
}

function Field({ label, value, span }) {
  return (
    <div style={{ gridColumn: span ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, letterSpacing: 0.8, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>{value || "—"}</div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("checkin");
  const [step, setStep] = useState("search");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [nature, setNature] = useState([]);
  const [othersText, setOthersText] = useState("");
  const [reason, setReason] = useState("");
  const [meridiem, setMeridiem] = useState(getMeridiem());
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastSlip, setLastSlip] = useState(null);
  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [filterNature, setFilterNature] = useState("All");
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (view === "log") {
      setLoadingLog(true);
      sbFetchSlips().then(setLog).catch(() => setLog([])).finally(() => setLoadingLog(false));
    }
  }, [view]);

  function resetForm() {
    setStep("search"); setSelectedStudent(null); setNature([]); setOthersText("");
    setReason(""); setMeridiem(getMeridiem()); setErrors({}); setSubmitError("");
  }
  function toggleNature(n) {
    setNature(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  }
  function validate() {
    const e = {};
    if (!selectedStudent) e.student = "Please select a student";
    if (nature.length === 0) e.nature = "Select at least one nature";
    if (nature.includes("Others") && !othersText.trim()) e.others = "Please specify";
    if (!reason.trim() || reason.trim().length < 10) e.reason = "Please provide a reason (min 10 characters)";
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true); setSubmitError("");
    const slip = {
      name: selectedStudent.name, student_id: selectedStudent.student_id,
      grade_section: selectedStudent.grade_section,
      nature: nature.map(n => n === "Others" ? `Others: ${othersText}` : n),
      reason: reason.trim(),
      meridiem: nature.includes("Late") ? meridiem : null,
      time_arrived: getTime(), date: getToday(), status: null,
    };
    try {
      const [saved] = await sbInsertSlip(slip);
      setLastSlip({ ...slip, id: saved?.id });
      setView("slip"); resetForm();
    } catch (err) { setSubmitError("Could not save. " + err.message); }
    finally { setSubmitting(false); }
  }
  async function handleStatusUpdate(slipId, status) {
    setUpdatingId(slipId);
    try {
      await sbUpdateStatus(slipId, status);
      setLog(prev => prev.map(s => s.id === slipId ? { ...s, status } : s));
    } catch (e) { console.error(e); }
    setUpdatingId(null);
  }

  const todayStr = getToday();
  const s = {
    root: { minHeight: "100vh", background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", color: C.text },
    header: { background: C.card, borderBottom: `2px solid ${C.primary}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
    badge: { background: C.primary, color: "#fff", fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase" },
    navBtn: (active) => ({ background: active ? C.primary : "transparent", color: active ? "#fff" : C.textMuted, border: `1px solid ${active ? C.primary : C.border}`, borderRadius: 6, padding: "6px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }),
    main: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px" },
    card: { background: C.card, borderRadius: 16, padding: "36px 40px", width: "100%", maxWidth: 560, boxShadow: "0 10px 40px rgba(15,23,42,0.08)", border: `1px solid ${C.border}` },
    label: { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: C.textMuted, textTransform: "uppercase", marginBottom: 8, display: "block" },
    errMsg: { fontSize: 12, color: C.danger, marginTop: 5 },
    natureBtn: (active) => ({ padding: "10px 14px", border: `2px solid ${active ? C.primary : C.border}`, background: active ? C.primaryBg : C.card, color: active ? C.primary : C.textMuted, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center" }),
    statusPill: (st) => {
      const map = { Excused: [C.success, "rgba(16,185,129,0.12)"], Unexcused: [C.danger, "rgba(239,68,68,0.12)"], "Admit Temporarily": [C.warning, "rgba(245,158,11,0.12)"] };
      const [color, bg] = map[st] || [C.textMuted, "rgba(100,116,139,0.12)"];
      return { background: bg, color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };
    },
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={s.badge}>POD</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Admission Slip — Discipline Office</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.textMuted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.success, background: "rgba(16,185,129,0.1)", border: `1px solid rgba(16,185,129,0.3)`, borderRadius: 20, padding: "3px 10px" }}>🟢 Supabase</span>
          <span>📅 {getToday()}</span>
          <span>🕐 <Clock /></span>
          <button style={s.navBtn(view === "checkin" || view === "slip")} onClick={() => { setView("checkin"); resetForm(); }}>New Slip</button>
          <button style={s.navBtn(view === "log")} onClick={() => setView("log")}>Log & Status</button>
        </div>
      </div>

      <div style={s.main}>
        {view === "checkin" && step === "search" && (
          <div style={s.card}>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6, color: C.text }}>Find Student</div>
            <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>Search by name or Student ID number.</div>
            <StudentSearch onSelect={st => { setSelectedStudent(st); setStep("form"); }} />
          </div>
        )}

        {view === "checkin" && step === "form" && (
          <div style={s.card}>
            <div style={{ background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 10, padding: "12px 16px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{selectedStudent?.name}</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{selectedStudent?.student_id} · {selectedStudent?.grade_section || "No section"}</div>
              </div>
              <button onClick={() => setStep("search")} style={{ background: "transparent", border: `1px solid ${C.primary}`, color: C.primary, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Change</button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={s.label}>Nature of Violation</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {NATURE_OPTIONS.map(n => (
                  <button key={n} style={s.natureBtn(nature.includes(n))} onClick={() => toggleNature(n)}>{n}</button>
                ))}
              </div>
              {nature.includes("Others") && (
                <input autoFocus value={othersText} onChange={e => setOthersText(e.target.value)} placeholder="Specify..."
                  style={{ width: "100%", marginTop: 8, background: C.card, border: `1.5px solid ${C.primary}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C.text, outline: "none", boxSizing: "border-box" }} />
              )}
              {errors.nature && <div style={s.errMsg}>{errors.nature}</div>}
              {errors.others && <div style={s.errMsg}>{errors.others}</div>}
            </div>

            {nature.includes("Late") && (
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>If Late</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {["A.M.", "P.M."].map(m => (
                    <button key={m} onClick={() => setMeridiem(m)} style={{ flex: 1, padding: "10px", border: `2px solid ${meridiem === m ? C.primary : C.border}`, background: meridiem === m ? C.primaryBg : C.card, color: meridiem === m ? C.primary : C.textMuted, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{m}</button>
                  ))}
                  <div style={{ flex: 2, background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.primary, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🕐 Time Arrived: <Clock />
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <label style={s.label}>Student's Reason / Explanation</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Student explains the reason for this violation..." rows={4}
                style={{ width: "100%", background: C.card, border: `1.5px solid ${reason.trim().length >= 10 ? C.primary : C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 14, color: C.text, outline: "none", boxSizing: "border-box", resize: "none", lineHeight: 1.6, fontFamily: "inherit" }} />
              <div style={{ fontSize: 12, marginTop: 4, textAlign: "right", color: reason.trim().length >= 10 ? C.success : C.textLight }}>
                {reason.trim().length < 10 ? `${10 - reason.trim().length} more characters needed` : "✓ Good"}
              </div>
              {errors.reason && <div style={s.errMsg}>{errors.reason}</div>}
            </div>

            {submitError && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>
                ⚠️ {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep("search")} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Back</button>
              <button onClick={handleSubmit} disabled={submitting} style={{ flex: 3, background: submitting ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Saving..." : "Generate Admission Slip →"}
              </button>
            </div>
          </div>
        )}

        {view === "slip" && lastSlip && (
          <SlipPreview slip={lastSlip} onDone={() => { setView("checkin"); resetForm(); }} />
        )}

        {view === "log" && (
          <div style={{ background: C.card, borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 1000, boxShadow: "0 10px 40px rgba(15,23,42,0.08)", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Admission Slip Log</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>POD officers can set status here</div>
              </div>
              <button onClick={() => { setLoadingLog(true); sbFetchSlips().then(setLog).catch(() => {}).finally(() => setLoadingLog(false)); }}
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄 Refresh</button>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                ["Today", log.filter(e => e.date === todayStr).length, C.primary],
                ["Pending", log.filter(e => !e.status).length, C.textMuted],
                ["Excused", log.filter(e => e.status === "Excused").length, C.success],
                ["Unexcused", log.filter(e => e.status === "Unexcused").length, C.danger],
                ["Admit Temp.", log.filter(e => e.status === "Admit Temporarily").length, C.warning],
                ["Total", log.length, C.text],
              ].map(([label, count, color]) => (
                <div key={label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", flex: "1 1 70px", minWidth: 70 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color }}>{count}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {["All", ...NATURE_OPTIONS].map(f => (
                <button key={f} onClick={() => setFilterNature(f)} style={{ background: filterNature === f ? C.primary : C.bg, color: filterNature === f ? "#fff" : C.textMuted, border: `1px solid ${filterNature === f ? C.primary : C.border}`, borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{f}</button>
              ))}
            </div>

            {loadingLog ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.bg }}>
                      {["Time", "Date", "Name", "ID", "Gr. & Sec.", "Nature", "Reason", "Status", "Set Status"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.filter(e => filterNature === "All" || (e.nature || []).some(n => n.startsWith(filterNature))).map((e, i) => (
                      <tr key={e.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "12px", color: C.primary, fontWeight: 700, whiteSpace: "nowrap" }}>{e.time_arrived}</td>
                        <td style={{ padding: "12px", color: C.textMuted, whiteSpace: "nowrap" }}>{e.date}</td>
                        <td style={{ padding: "12px", fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{e.name}</td>
                        <td style={{ padding: "12px", color: C.textMuted, fontFamily: "monospace" }}>{e.student_id}</td>
                        <td style={{ padding: "12px", color: C.text, whiteSpace: "nowrap" }}>{e.grade_section}</td>
                        <td style={{ padding: "12px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {(e.nature || []).map(n => (
                              <span key={n} style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{n}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: "12px", color: C.textMuted, fontStyle: "italic", maxWidth: 180 }}>{e.reason || "—"}</td>
                        <td style={{ padding: "12px" }}>
                          {e.status ? <span style={s.statusPill(e.status)}>{e.status}</span> : <span style={{ fontSize: 11, color: C.textLight }}>Pending</span>}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {STATUS_OPTIONS.map(st => (
                              <button key={st} disabled={updatingId === e.id || e.status === st} onClick={() => handleStatusUpdate(e.id, st)}
                                style={{ padding: "4px 9px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: e.status === st ? "default" : "pointer", whiteSpace: "nowrap", background: e.status === st ? C.bg : C.card, color: e.status === st ? C.textLight : C.text, border: `1px solid ${C.border}`, opacity: updatingId === e.id ? 0.5 : 1 }}>
                                {st === "Admit Temporarily" ? "Admit Temp." : st}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {log.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No slips yet.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
