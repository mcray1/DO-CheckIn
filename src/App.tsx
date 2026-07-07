import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://ghofeoxrkrcibzeqcbih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2Zlb3hya3JjaWJ6ZXFjYmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTI4MTIsImV4cCI6MjA5ODIyODgxMn0.RsFkrqiuv4CzXGRg2FP33nTj5dMUtD2aF8w5NQYtmKQ";

const sbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const C = {
  primary: "#1e40af", primaryLight: "#3b82f6", primaryBg: "#dbeafe",
  bg: "#f1f5f9", card: "#ffffff", text: "#1e293b",
  textMuted: "#64748b", textLight: "#94a3b8", border: "#e2e8f0",
  success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
};

const STATUS_OPTIONS = ["Excused", "Unexcused", "Admit Temporarily"];

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

// ── Data fetching ─────────────────────────────────────────────────
async function fetchCategories() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/categories?is_active=eq.true&order=sort_order&select=id,name,description,requires_reason,requires_teacher`, { headers: sbHeaders });
  if (!res.ok) return [];
  return res.json();
}

async function fetchKeywords() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/keywords?is_active=eq.true&select=nature,keyword,suggested_status,weight,sub_category_id`, { headers: sbHeaders });
  if (!res.ok) return [];
  return res.json();
}

async function fetchSubCategories() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sub_categories?is_active=eq.true&select=id,name,category_id,suggested_status,document_required,document_description,document_deadline_days`, { headers: sbHeaders });
  if (!res.ok) return [];
  return res.json();
}

async function searchStudents(query) {
  if (!query || query.trim().length < 2) return [];
  const q = encodeURIComponent(query.trim());
  const res = await fetch(`${SUPABASE_URL}/rest/v1/students?or=(name.ilike.*${q}*,student_no.ilike.*${q}*)&select=name,student_no,level,section&limit=20`, { headers: sbHeaders });
  if (!res.ok) return [];
  const all = await res.json();
  return all.slice(0, 8).map(r => ({
    name: r.name, student_id: r.student_no,
    grade_section: [r.level, r.section].filter(Boolean).join(" - "),
  }));
}

async function searchTeachers(query) {
  if (!query || query.trim().length < 2) return [];
  const q = encodeURIComponent(query.trim());
  const res = await fetch(`${SUPABASE_URL}/rest/v1/teachers?is_active=eq.true&or=(first_name.ilike.*${q}*,last_name.ilike.*${q}*)&select=id,first_name,last_name,middle_name,email&limit=20`, { headers: sbHeaders });
  if (!res.ok) return [];
  const all = await res.json();
  return all.slice(0, 8).map(t => ({
    id: t.id,
    full_name: `${t.last_name}, ${t.first_name}${t.middle_name ? " " + t.middle_name : ""}`,
    email: t.email || "",
  }));
}

async function sbInsertSlip(slip) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admission_slips`, {
    method: "POST",
    headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(slip),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Rules-based classifier (keywords from DB) ─────────────────────
function classifyReason(reason, categoryName, keywords, subCategories) {
  const r = reason.toLowerCase();
  const relevantKw = keywords.filter(k => k.nature === categoryName || k.nature === "Any");

  const scores = {}; // sub_category_id -> { score, status }
  for (const k of relevantKw) {
    if (r.includes(k.keyword.toLowerCase())) {
      if (!scores[k.sub_category_id]) scores[k.sub_category_id] = { score: 0, statusVotes: {} };
      scores[k.sub_category_id].score += k.weight;
      const st = k.suggested_status;
      scores[k.sub_category_id].statusVotes[st] = (scores[k.sub_category_id].statusVotes[st] || 0) + k.weight;
    }
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { sub_category: null, status: "Admit Temporarily", confidence: "medium",
      explanation: "No matching keywords. POD officer review needed." };
  }

  entries.sort((a, b) => b[1].score - a[1].score);
  const [bestId, bestData] = entries[0];
  const sub = subCategories.find(s => String(s.id) === String(bestId));
  const topStatus = Object.entries(bestData.statusVotes).sort((a, b) => b[1] - a[1])[0][0];

  return {
    sub_category: sub ? sub.name : null,
    sub_category_id: bestId,
    status: topStatus,
    confidence: bestData.score >= 2 ? "high" : "medium",
    explanation: `Matched keywords suggest "${sub ? sub.name : "?"}" — ${topStatus}.`,
    document_required: sub?.document_required || false,
    document_description: sub?.document_description || null,
    document_deadline_days: sub?.document_deadline_days || null,
  };
}

// ── Generic searchable dropdown ───────────────────────────────────
function SearchBox({ placeholder, searchFn, onSelect, renderItem, autoFocus }) {
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
      const r = await searchFn(val);
      setResults(r);
      setLoading(false);
    }, 300);
  }

  return (
    <div style={{ position: "relative" }}>
      <input autoFocus={autoFocus} value={query} onChange={handleChange} placeholder={placeholder}
        style={{ width: "100%", background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", fontSize: 16, color: C.text, outline: "none", boxSizing: "border-box" }} />
      {(loading || results.length > 0 || (query.length >= 2 && !loading)) && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 10px 30px rgba(15,23,42,0.12)", maxHeight: 320, overflowY: "auto" }}>
          {loading && <div style={{ padding: "14px 16px", color: C.textMuted, fontSize: 14 }}>Searching...</div>}
          {!loading && results.map((item, i) => (
            <div key={i} onClick={() => { onSelect(item); setQuery(""); setResults([]); }}
              style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => e.currentTarget.style.background = C.primaryBg}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {renderItem(item)}
            </div>
          ))}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "14px 16px", color: C.textMuted, fontSize: 14 }}>No results found.</div>
          )}
        </div>
      )}
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

function SlipPreview({ slip, onDone }) {
  const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning };
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
        <Field label="Teacher" value={slip.teacher_name} span={true} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: C.textMuted }}>NATURE:</div>
        <span style={{ background: C.primary, color: "#fff", borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{slip.category_name}</span>
        {slip.meridiem && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 700 }}>{slip.meridiem}</span>}
      </div>
      {slip.reason && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: C.textMuted }}>REASON:</div>
          <div style={{ fontSize: 13, fontStyle: "italic", color: C.text, lineHeight: 1.5, background: C.bg, borderRadius: 6, padding: "10px 12px" }}>"{slip.reason}"</div>
        </div>
      )}
      {slip.ai_sub_category && (
        <div style={{ marginBottom: 14, background: `${statusColors[slip.ai_status] || C.textMuted}12`, border: `1px solid ${statusColors[slip.ai_status] || C.border}`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 4 }}>🤖 SYSTEM SUGGESTION</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: statusColors[slip.ai_status] || C.text }}>{slip.ai_sub_category} · {slip.ai_status}</div>
        </div>
      )}
      {slip.document_required && (
        <div style={{ marginBottom: 14, background: "rgba(245,158,11,0.1)", border: `1px solid ${C.warning}`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.warning, marginBottom: 4 }}>📄 DOCUMENT REQUIRED</div>
          <div style={{ fontSize: 13, color: C.text }}>{slip.document_description}</div>
          {slip.document_deadline && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Submit by: {slip.document_deadline}</div>}
        </div>
      )}
      <div style={{ background: C.primaryBg, borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
        Please see the <strong>POD officer</strong> for confirmation before proceeding to class.
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginBottom: 16, fontSize: 11, color: C.textLight, textAlign: "center" }}>
        Signed: ________________________<br />
        <span style={{ fontWeight: 700 }}>Prefect of Discipline / Discipline Officer</span>
      </div>
      <button onClick={onDone} style={{ width: "100%", background: C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Done — Next Student</button>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState("search"); // search | form | slip
  const [categories, setCategories] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [reason, setReason] = useState("");
  const [meridiem, setMeridiem] = useState(getMeridiem());
  const [aiResult, setAiResult] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastSlip, setLastSlip] = useState(null);

  // Load reference data once on mount (Option A)
  useEffect(() => {
    Promise.all([fetchCategories(), fetchKeywords(), fetchSubCategories()])
      .then(([cats, kws, subs]) => {
        setCategories(cats);
        setKeywords(kws);
        setSubCategories(subs);
      })
      .finally(() => setDataLoading(false));
  }, []);

  // Classify as reason changes
  useEffect(() => {
    if (!reason.trim() || reason.trim().length < 5 || !selectedCategory) {
      setAiResult(null);
      return;
    }
    const result = classifyReason(reason, selectedCategory.name, keywords, subCategories);
    setAiResult(result);
  }, [reason, selectedCategory, keywords, subCategories]);

  function resetForm() {
    setStep("search");
    setSelectedStudent(null);
    setSelectedCategory(null);
    setSelectedTeacher(null);
    setReason("");
    setMeridiem(getMeridiem());
    setAiResult(null);
    setErrors({});
    setSubmitError("");
  }

  function validate() {
    const e = {};
    if (!selectedStudent) e.student = "Please select a student";
    if (!selectedCategory) e.category = "Select the nature of visit";
    if (selectedCategory?.requires_teacher && !selectedTeacher) e.teacher = "Select the teacher";
    if (selectedCategory?.requires_reason && (!reason.trim() || reason.trim().length < 10)) e.reason = "Please provide a reason (min 10 characters)";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function computeDeadline(days) {
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true); setSubmitError("");
    const docDeadline = aiResult?.document_required ? computeDeadline(aiResult.document_deadline_days) : null;
    const slip = {
      name: selectedStudent.name,
      student_id: selectedStudent.student_id,
      grade_section: selectedStudent.grade_section,
      category_id: selectedCategory.id,
      teacher_id: selectedTeacher?.id || null,
      teacher_name: selectedTeacher?.full_name || null,
      teacher_email: selectedTeacher?.email || null,
      nature: [selectedCategory.name],
      reason: reason.trim() || null,
      meridiem: selectedCategory.name === "Late" ? meridiem : null,
      time_arrived: getTime(),
      date: getToday(),
      ai_sub_category: aiResult?.sub_category || null,
      ai_status: aiResult?.status || null,
      ai_explanation: aiResult?.explanation || null,
      status: null,
      document_required: aiResult?.document_required || false,
      document_status: aiResult?.document_required ? "Promised" : "Not Required",
      document_deadline: docDeadline,
      notification_sent: false,
    };
    try {
      await sbInsertSlip(slip);
      setLastSlip({
        ...slip,
        category_name: selectedCategory.name,
        document_description: aiResult?.document_description,
      });
      setStep("slip");
    } catch (err) {
      setSubmitError("Could not save. " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning };

  const s = {
    root: { minHeight: "100vh", background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", color: C.text },
    header: { background: C.card, borderBottom: `2px solid ${C.primary}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
    badge: { background: C.primary, color: "#fff", fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 4, letterSpacing: 1, textTransform: "uppercase" },
    main: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px" },
    card: { background: C.card, borderRadius: 16, padding: "36px 40px", width: "100%", maxWidth: 580, boxShadow: "0 10px 40px rgba(15,23,42,0.08)", border: `1px solid ${C.border}` },
    label: { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: C.textMuted, textTransform: "uppercase", marginBottom: 8, display: "block" },
    errMsg: { fontSize: 12, color: C.danger, marginTop: 5 },
    catBtn: (active) => ({ padding: "14px 10px", border: `2px solid ${active ? C.primary : C.border}`, background: active ? C.primaryBg : C.card, color: active ? C.primary : C.textMuted, borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center" }),
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={s.badge}>POD</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Admission Slip — Discipline Office</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.textMuted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.success, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 20, padding: "3px 10px" }}>🟢 Supabase</span>
          <span>📅 {getToday()}</span>
          <span>🕐 <Clock /></span>
        </div>
      </div>

      <div style={s.main}>

        {/* STEP 1: SEARCH STUDENT */}
        {step === "search" && (
          <div style={s.card}>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6, color: C.text }}>Find Student</div>
            <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>Search by name or Student ID number.</div>
            <SearchBox
              placeholder="Type name or Student ID..."
              searchFn={searchStudents}
              autoFocus
              onSelect={st => { setSelectedStudent(st); setStep("form"); }}
              renderItem={item => (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: C.text }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{item.grade_section}</div>
                  </div>
                  <span style={{ fontSize: 13, color: C.textMuted, fontFamily: "monospace" }}>{item.student_id}</span>
                </div>
              )}
            />
            {dataLoading && <div style={{ marginTop: 16, fontSize: 13, color: C.textLight }}>Loading categories...</div>}
          </div>
        )}

        {/* STEP 2: FORM */}
        {step === "form" && (
          <div style={s.card}>
            <div style={{ background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 10, padding: "12px 16px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{selectedStudent?.name}</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{selectedStudent?.student_id} · {selectedStudent?.grade_section || "No section"}</div>
              </div>
              <button onClick={resetForm} style={{ background: "transparent", border: `1px solid ${C.primary}`, color: C.primary, borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Change</button>
            </div>

            {/* Category buttons from DB */}
            <div style={{ marginBottom: 20 }}>
              <label style={s.label}>Nature of Visit</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {categories.map(cat => (
                  <button key={cat.id} style={s.catBtn(selectedCategory?.id === cat.id)}
                    onClick={() => { setSelectedCategory(cat); if (cat.name !== "Late") setMeridiem(getMeridiem()); }}
                    title={cat.description || ""}>
                    {cat.name}
                  </button>
                ))}
              </div>
              {errors.category && <div style={s.errMsg}>{errors.category}</div>}
            </div>

            {/* Teacher dropdown (if required) */}
            {selectedCategory?.requires_teacher && (
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>Teacher</label>
                {selectedTeacher ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 8, padding: "10px 14px" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{selectedTeacher.full_name}</div>
                      <div style={{ fontSize: 12, color: C.textMuted }}>{selectedTeacher.email}</div>
                    </div>
                    <button onClick={() => setSelectedTeacher(null)} style={{ background: "transparent", border: `1px solid ${C.primary}`, color: C.primary, borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Change</button>
                  </div>
                ) : (
                  <SearchBox
                    placeholder="Search teacher by name..."
                    searchFn={searchTeachers}
                    onSelect={t => setSelectedTeacher(t)}
                    renderItem={item => (
                      <div>
                        <div style={{ fontWeight: 600, color: C.text }}>{item.full_name}</div>
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{item.email}</div>
                      </div>
                    )}
                  />
                )}
                {errors.teacher && <div style={s.errMsg}>{errors.teacher}</div>}
              </div>
            )}

            {/* AM/PM for Late */}
            {selectedCategory?.name === "Late" && (
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>If Late</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {["A.M.", "P.M."].map(m => (
                    <button key={m} onClick={() => setMeridiem(m)} style={{ flex: 1, padding: "10px", border: `2px solid ${meridiem === m ? C.primary : C.border}`, background: meridiem === m ? C.primaryBg : C.card, color: meridiem === m ? C.primary : C.textMuted, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{m}</button>
                  ))}
                  <div style={{ flex: 2, background: C.primaryBg, border: `1px solid ${C.primary}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.primary, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🕐 Time: <Clock />
                  </div>
                </div>
              </div>
            )}

            {/* Reason */}
            {selectedCategory?.requires_reason && (
              <div style={{ marginBottom: 24 }}>
                <label style={s.label}>Reason / Explanation</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain the reason in your own words..." rows={3}
                  style={{ width: "100%", background: C.card, border: `1.5px solid ${reason.trim().length >= 10 ? C.primary : C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 14, color: C.text, outline: "none", boxSizing: "border-box", resize: "none", lineHeight: 1.6, fontFamily: "inherit" }} />
                <div style={{ fontSize: 12, marginTop: 4, textAlign: "right", color: reason.trim().length >= 10 ? C.success : C.textLight }}>
                  {reason.trim().length < 10 ? `${10 - reason.trim().length} more characters needed` : "✓ Good"}
                </div>
                {errors.reason && <div style={s.errMsg}>{errors.reason}</div>}

                {/* System suggestion (visible to student as info, POD confirms later) */}
                {aiResult && (
                  <div style={{ marginTop: 10, background: `${statusColors[aiResult.status] || C.textMuted}10`, border: `1.5px solid ${statusColors[aiResult.status] || C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>🤖 System Suggestion (POD will confirm)</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: statusColors[aiResult.status] || C.text }}>
                      {aiResult.sub_category ? `${aiResult.sub_category} · ` : ""}{aiResult.status}
                    </div>
                    {aiResult.document_required && (
                      <div style={{ fontSize: 12, color: C.warning, marginTop: 4, fontWeight: 600 }}>📄 Will require: {aiResult.document_description}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {submitError && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>
                ⚠️ {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={resetForm} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>← Back</button>
              <button onClick={handleSubmit} disabled={submitting} style={{ flex: 3, background: submitting ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Saving..." : "Submit →"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: SLIP */}
        {step === "slip" && lastSlip && (
          <SlipPreview slip={lastSlip} onDone={resetForm} />
        )}

      </div>
    </div>
  );
}
