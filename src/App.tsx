import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://ghofeoxrkrcibzeqcbih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2Zlb3hya3JjaWJ6ZXFjYmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTI4MTIsImV4cCI6MjA5ODIyODgxMn0.RsFkrqiuv4CzXGRg2FP33nTj5dMUtD2aF8w5NQYtmKQ";

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
  const q = query.trim().toLowerCase();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/students?select=name,student_no,level,section,rfid&limit=3000`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return [];
  const all = await res.json();
  const filtered = all.filter(r =>
    (r.name || "").toLowerCase().includes(q) ||
    (r.student_no || "").toLowerCase().includes(q)
  );
  return filtered.slice(0, 8).map(r => ({
    name: r.name,
    student_id: r.student_no,
    grade_section: [r.level, r.section].filter(Boolean).join(" - "),
    rfid: r.rfid || "",
  }));
}

async function sbInsertSlip(slip) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(slip),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbFetchSlips() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admission_slips?order=created_at.desc&limit=3000`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbUpdateStatus(id, status) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=representation",
    },
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
      <input
        autoFocus
        value={query}
        onChange={handleChange}
        placeholder="Type name or Student ID..."
        style={{ width: "100%", background: "#0f172a", border: "1.5px solid #334155", borderRadius: 10, padding: "14px 16px", fontSize: 17, color: "#f1f5f9", outline: "none", boxSizing: "border-box" }}
      />
      {(loading || results.length > 0 || (query.length >= 2 && !loading)) && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#1e293b", border: "1px solid #334155", borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
          {loading && <div style={{ padding: "14px 16px", color: "#64748b", fontSize: 14 }}>Searching...</div>}
          {!loading && results.map(s => (
            <div key={s.student_id} onClick={() => { onSelect(s); setQuery(""); setResults([]); }}
              style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #0f172a", display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onMouseEnter={e => e.currentTarget.style.background = "#0f172a"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div>
                <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{s.grade_section}</div>
              </div>
              <span style={{ fontSize: 13, color: "#64748b" }}>{s.student_id}</span>
            </div>
          ))}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "14px 16px", color: "#64748b", fontSize: 14 }}>No students found.</div>
          )}
        </div>
      )}
    </div>
  );
}

function SlipPreview({ slip, onDone }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "32px 36px", width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", color: "#0f172a" }}>
      <div style={{ textAlign: "center", marginBottom: 20, borderBottom: "2px solid #0f172a", paddingBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#475569" }}>ATENEO DE ILOILO – SMCS</div>
        <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>DISCIPLINE OFFICE</div>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 2 }}>ADMISSION SLIP</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 16 }}>
        <Field label="Name" value={slip.name} span={true} />
        <Field label="Date" value={slip.date} />
        <Field label="Time Arrived" value={slip.time_arrived} />
        <Field label="Gr. & Sec." value={slip.grade_section} span={true} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>NATURE:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {slip.nature.map(n => (
            <span key={n} style={{ background: "#0f172a", color: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{n}</span>
          ))}
        </div>
      </div>

      {slip.nature.includes("Late") && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>IF LATE: </span>
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 8 }}>{slip.meridiem}</span>
        </div>
      )}

      {slip.reason && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>REASON:</div>
          <div style={{ fontSize: 13, fontStyle: "italic", color: "#334155", lineHeight: 1.5, background: "#f8fafc", borderRadius: 6, padding: "8px 10px" }}>"{slip.reason}"</div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>STATUS:</div>
        <div style={{ display: "flex", gap: 8 }}>
          {STATUS_OPTIONS.map(s => (
            <span key={s} style={{ borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700, background: slip.status === s ? "#0f172a" : "#f1f5f9", color: slip.status === s ? "#fff" : "#94a3b8", border: "1px solid " + (slip.status === s ? "#0f172a" : "#e2e8f0") }}>{s}</span>
          ))}
        </div>
        {!slip.status && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6 }}>⏳ Pending — POD officer will set status</div>}
      </div>

      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, marginBottom: 16, fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
        Signed: ________________________<br />
        <span style={{ fontWeight: 700 }}>Prefect of Discipline / Discipline Officer</span>
      </div>

      <button onClick={onDone} style={{ width: "100%", background: "#0f172a", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 800, cursor: "pointer" }}>Next Student</button>
    </div>
  );
}

function Field({ label, value, span }) {
  return (
    <div style={{ gridColumn: span ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.8, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, borderBottom: "1px solid #cbd5e1", paddingBottom: 3 }}>{value || "—"}</div>
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
      name: selectedStudent.name,
      student_id: selectedStudent.student_id,
      grade_section: selectedStudent.grade_section,
      nature: nature.map(n => n === "Others" ? `Others: ${othersText}` : n),
      reason: reason.trim(),
      meridiem: nature.includes("Late") ? meridiem : null,
      time_arrived: getTime(),
      date: getToday(),
      status: null,
    };
    try {
      const [saved] = await sbInsertSlip(slip);
      setLastSlip({ ...slip, id: saved?.id });
      setView("slip");
      resetForm();
    } catch (err) {
      setSubmitError("Could not save. " + err.message);
    } finally {
      setSubmitting(false);
    }
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
    root: { minHeight: "100vh", background: "#0f172a", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", color: "#f8fafc" },
    header: { background: "#1e293b", borderBottom: "2px solid #f59e0b", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
    badge: { background: "#f59e0b", color: "#0f172a", fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase" },
    navBtn: (active) => ({ background: active ? "#f59e0b" : "transparent", color: active ? "#0f172a" : "#94a3b8", border: "1px solid " + (active ? "#f59e0b" : "#334155"), borderRadius: 6, padding: "6px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }),
    main: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px" },
    card: { background: "#1e293b", borderRadius: 16, padding: "36px 40px", width: "100%", maxWidth: 560, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" },
    label: { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: "#94a3b8", textTransform: "uppercase", marginBottom: 8, display: "block" },
    errMsg: { fontSize: 12, color: "#ef4444", marginTop: 5 },
    natureBtn: (active) => ({ padding: "10px 14px", border: "2px solid " + (active ? "#f59e0b" : "#334155"), background: active ? "rgba(245,158,11,0.12)" : "#0f172a", color: active ? "#f59e0b" : "#64748b", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center" }),
    statusPill: (st) => {
      const map = { Excused: ["#10b981","rgba(16,185,129,0.12)"], Unexcused: ["#ef4444","rgba(239,68,68,0.12)"], "Admit Temporarily": ["#f59e0b","rgba(245,158,11,0.12)"] };
      const [color, bg] = map[st] || ["#64748b","rgba(100,116,139,0.12)"];
      return { background: bg, color, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" };
    },
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={s.badge}>POD</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>Admission Slip — Discipline Office</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#94a3b8" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 20, padding: "3px 10px" }}>🟢 Supabase</span>
          <span>📅 {getToday()}</span>
          <span>🕐 <Clock /></span>
          <button style={s.navBtn(view === "checkin" || view === "slip")} onClick={() => { setView("checkin"); resetForm(); }}>New Slip</button>
          <button style={s.navBtn(view === "log")} onClick={() => setView("log")}>Log & Status</button>
        </div>
      </div>

      <div style={s.main}>
        {view === "checkin" && step === "search" && (
          <div style={s.card}>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6, color: "#f1f5f9" }}>Find Student</div>
            <div style={{ fontSize: 14, color: "#64748b", marginBottom: 28 }}>Search by name or Student ID number.</div>
            <StudentSearch onSelect={st => { setSelectedStudent(st); setStep("form"); }} />
          </div>
        )}

        {view === "checkin" && step === "form" && (
          <div style={s.card}>
            <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "12px 16px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#f1f5f9" }}>{selectedStudent?.name}</div>
                <div style={{ fontSize: 13, color: "#64748b" }}>{selectedStudent?.student_id} · {selectedStudent?.grade_section || "No section"}</div>
              </div>
              <button onClick={() => setStep("search")} style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Change</button>
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
                  style={{ width: "100%", marginTop: 8, background: "#0f172a", border: "1.5px solid #f59e0b", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "#f1f5f9", outline: "none", boxSizing: "border-box" }} />
              )}
              {errors.nature && <div style={s.errMsg}>{errors.nature}</div>}
              {errors.others && <div style={s.errMsg}>{errors.others}</div>}
            </div>

            {nature.includes("Late") && (
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>If Late</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {["A.M.", "P.M."].map(m => (
                    <button key={m} onClick={() => setMeridiem(m)} style={{ flex: 1, padding: "10px", border: "2px solid " + (meridiem === m ? "#f59e0b" : "#334155"), background: meridiem === m ? "rgba(245,158,11,0.12)" : "#0f172a", color: meridiem === m ? "#f59e0b" : "#64748b", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{m}</button>
                  ))}
                  <div style={{ flex: 2, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#f59e0b", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🕐 Time Arrived: <Clock />
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <label style={s.label}>Student's Reason / Explanation</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Student explains the reason for this violation..." rows={4}
                style={{ width: "100%", background: "#0f172a", border: "1.5px solid " + (reason.trim().length >= 10 ? "#f59e0b" : "#334155"), borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "#f1f5f9", outline: "none", boxSizing: "border-box", resize: "none", lineHeight: 1.6, fontFamily: "inherit" }} />
              <div style={{ fontSize: 12, marginTop: 4, textAlign: "right", color: reason.trim().length >= 10 ? "#f59e0b" : "#475569" }}>
                {reason.trim().length < 10 ? `${10 - reason.trim().length} more characters needed` : "✓ Good"}
              </div>
              {errors.reason && <div style={s.errMsg}>{errors.reason}</div>}
            </div>

            {submitError && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171", marginBottom: 12 }}>
                ⚠️ {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep("search")} style={{ flex: 1, background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Back</button>
              <button onClick={handleSubmit} disabled={submitting} style={{ flex: 3, background: submitting ? "#334155" : "#f59e0b", color: submitting ? "#64748b" : "#0f172a", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 800, cursor: submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Saving..." : "Generate Admission Slip →"}
              </button>
            </div>
          </div>
        )}

        {view === "slip" && lastSlip && (
          <SlipPreview slip={lastSlip} onDone={() => { setView("checkin"); resetForm(); }} />
        )}

        {view === "log" && (
          <div style={{ background: "#1e293b", borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 1000, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>Admission Slip Log</div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>POD officers can set status here</div>
              </div>
              <button onClick={() => { setLoadingLog(true); sbFetchSlips().then(setLog).catch(() => {}).finally(() => setLoadingLog(false)); }}
                style={{ background: "#0f172a", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer" }}>🔄 Refresh</button>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                ["Today", log.filter(e => e.date === todayStr).length, "#f59e0b"],
                ["Pending", log.filter(e => !e.status).length, "#64748b"],
                ["Excused", log.filter(e => e.status === "Excused").length, "#10b981"],
                ["Unexcused", log.filter(e => e.status === "Unexcused").length, "#ef4444"],
                ["Admit Temp.", log.filter(e => e.status === "Admit Temporarily").length, "#a78bfa"],
                ["Total", log.length, "#38bdf8"],
              ].map(([label, count, color]) => (
                <div key={label} style={{ background: "#0f172a", border: `1px solid ${color}`, borderRadius: 10, padding: "10px 16px", flex: "1 1 70px", minWidth: 70 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color }}>{count}</div>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {["All", ...NATURE_OPTIONS].map(f => (
                <button key={f} onClick={() => setFilterNature(f)} style={{ background: filterNature === f ? "#f59e0b" : "#0f172a", color: filterNature === f ? "#0f172a" : "#64748b", border: "1px solid " + (filterNature === f ? "#f59e0b" : "#334155"), borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{f}</button>
              ))}
            </div>

            {loadingLog ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>Loading...</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>{["Time", "Date", "Name", "ID", "Gr. & Sec.", "Nature", "Reason", "Status", "Set Status"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {log.filter(e => filterNature === "All" || (e.nature || []).some(n => n.startsWith(filterNature))).map((e, i) => (
                      <tr key={e.id || i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", color: "#f59e0b", fontWeight: 700, whiteSpace: "nowrap" }}>{e.time_arrived}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", color: "#cbd5e1", whiteSpace: "nowrap" }}>{e.date}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", fontWeight: 600, color: "#f1f5f9", whiteSpace: "nowrap" }}>{e.name}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", color: "#64748b" }}>{e.student_id}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", color: "#cbd5e1", whiteSpace: "nowrap" }}>{e.grade_section}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {(e.nature || []).map(n => (
                              <span key={n} style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{n}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b", color: "#94a3b8", fontStyle: "italic", maxWidth: 180 }}>{e.reason || "—"}</td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b" }}>
                          {e.status ? <span style={s.statusPill(e.status)}>{e.status}</span> : <span style={{ fontSize: 11, color: "#475569" }}>Pending</span>}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #1e293b" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {STATUS_OPTIONS.map(st => (
                              <button key={st} disabled={updatingId === e.id || e.status === st} onClick={() => handleStatusUpdate(e.id, st)}
                                style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap", background: e.status === st ? "#334155" : "#0f172a", color: e.status === st ? "#64748b" : "#94a3b8", border: "1px solid #334155", opacity: updatingId === e.id ? 0.5 : 1 }}>
                                {st === "Admit Temporarily" ? "Admit Temp." : st}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {log.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>No slips yet.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
