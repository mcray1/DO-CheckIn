import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";

// Directory management (manage_directory permission): advisers now, students next.
// An adviser's level + section is what lets the kiosk resolve a student's adviser
// automatically, so those two fields matter more than they look.

const PAGE_SIZE = 25;

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function apiInsert(table, body) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiUpdate(table, id, patch) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── shared bits ───────────────────────────────────────────────────
function labelStyle() {
  return { fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" };
}
function inputStyle() {
  return { width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" };
}
function smallBtn(fg) {
  return { background: C.card, color: fg, border: `1px solid ${fg}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
}
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: C.card, borderRadius: 14, padding: "24px 28px", width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: C.textLight, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Level+section pairs that students are actually in — the source of truth for
// adviser assignment, so a typo can't break kiosk matching.
async function fetchStudentSections() {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/student_sections?select=level,section`, { headers });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows
    .filter(r => r.section)
    .sort((a, b) => `${a.level || ""}${a.section}`.localeCompare(`${b.level || ""}${b.section}`));
}
const sectionKey = (level, section) => `${level || ""}||${section || ""}`;

function AdviserModal({ initial, sections = [], onSave, onClose }) {
  const [f, setF] = useState({
    employee_id: initial?.employee_id || "",
    first_name: initial?.first_name || "",
    last_name: initial?.last_name || "",
    middle_name: initial?.middle_name || "",
    email: initial?.email || "",
    department: initial?.department || "",
    level: initial?.level || "",
    section: initial?.section || "",
    is_active: initial?.is_active ?? true,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.first_name.trim() || !f.last_name.trim()) return setErr("First and last name are required.");
    if (f.email && !f.email.includes("@")) return setErr("That email doesn't look right.");
    setBusy(true); setErr("");
    try {
      await onSave({
        employee_id: f.employee_id.trim() || null,
        first_name: f.first_name.trim(), last_name: f.last_name.trim(),
        middle_name: f.middle_name.trim() || null,
        email: f.email.trim().toLowerCase() || null,
        department: f.department.trim() || null,
        level: f.level.trim() || null,
        section: f.section.trim() || null,
        is_active: f.is_active,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit — ${initial.last_name}, ${initial.first_name}` : "New Adviser"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={labelStyle()}>Last name</label><input value={f.last_name} onChange={set("last_name")} style={inputStyle()} /></div>
        <div><label style={labelStyle()}>First name</label><input value={f.first_name} onChange={set("first_name")} style={inputStyle()} /></div>
        <div><label style={labelStyle()}>Middle name</label><input value={f.middle_name} onChange={set("middle_name")} style={inputStyle()} /></div>
        <div><label style={labelStyle()}>Employee ID</label><input value={f.employee_id} onChange={set("employee_id")} style={inputStyle()} /></div>
      </div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Email (for slip notifications)</label>
        <input value={f.email} onChange={set("email")} placeholder="name@adi.edu.ph" style={inputStyle()} /></div>
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          The kiosk finds a student's adviser by matching their grade level and section, so students never pick a name. Choose from the sections students are actually enrolled in.
        </div>
        <label style={labelStyle()}>Advisory class</label>
        {sections.length === 0 ? (
          <div style={{ fontSize: 13, color: C.warning }}>
            No student sections found yet — import students first, then set advisory classes.
          </div>
        ) : (
          <select
            value={sectionKey(f.level, f.section)}
            onChange={e => {
              const [level, section] = e.target.value.split("||");
              setF({ ...f, level: level || "", section: section || "" });
            }}
            style={{ ...inputStyle(), background: C.card }}>
            <option value="||">— None (adviser won't be auto-assigned) —</option>
            {/* Keep an existing value that no longer matches any student section. */}
            {f.section && !sections.some(s => sectionKey(s.level, s.section) === sectionKey(f.level, f.section)) && (
              <option value={sectionKey(f.level, f.section)}>
                {[f.level, f.section].filter(Boolean).join(" · ")} (no students)
              </option>
            )}
            {sections.map(s => (
              <option key={sectionKey(s.level, s.section)} value={sectionKey(s.level, s.section)}>
                {[s.level, s.section].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        )}
      </div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Department</label>
        <input value={f.department} onChange={set("department")} style={inputStyle()} /></div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} style={{ width: 16, height: 16 }} />
        Active
      </label>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving..." : "Save"}</button>
      </div>
    </Modal>
  );
}

// ── Advisers ──────────────────────────────────────────────────────
function Advisers() {
  const [rows, setRows] = useState([]);
  const [sections, setSections] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const q = search.trim();
      const filter = q
        ? `&or=(first_name.ilike.*${encodeURIComponent(q)}*,last_name.ilike.*${encodeURIComponent(q)}*,section.ilike.*${encodeURIComponent(q)}*)`
        : "";
      const from = page * PAGE_SIZE;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/teachers?select=id,employee_id,first_name,last_name,middle_name,email,department,level,section,is_active&order=last_name${filter}`,
        { headers: { ...headers, Range: `${from}-${from + PAGE_SIZE - 1}`, Prefer: "count=exact" } });
      if (!res.ok) throw new Error(await res.text());
      setRows(await res.json());
      const cr = res.headers.get("content-range"); // e.g. "0-24/187"
      setTotal(cr && cr.includes("/") ? Number(cr.split("/")[1]) || 0 : 0);
    } catch (e) {
      setError("Could not load advisers: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page]);
  useEffect(() => { fetchStudentSections().then(setSections); }, []);
  useEffect(() => { const t = setTimeout(() => { setPage(0); load(); }, 350); return () => clearTimeout(t); }, [search]);

  function flash(m) { setNotice(m); setTimeout(() => setNotice(""), 3000); }
  async function run(fn, msg) {
    setError("");
    try { await fn(); await load(); flash(msg); }
    catch (e) { setError(e.message); throw e; }
  }

  const td = { padding: "10px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 13, whiteSpace: "nowrap" };
  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or section..."
          style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, outline: "none", width: 240 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
          <button onClick={() => setCreating(true)} style={{ background: C.primary, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>+ New Adviser</button>
        </div>
      </div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No advisers found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: C.bg }}>
              {["Name", "Level & Section", "Email", "Status", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{t.last_name}, {t.first_name}</td>
                  <td style={td}>
                    {t.section
                      ? <span style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{[t.level, t.section].filter(Boolean).join(" · ")}</span>
                      : <span style={{ color: C.warning, fontSize: 12, fontWeight: 600 }}>not set</span>}
                  </td>
                  <td style={{ ...td, color: C.textMuted }}>{t.email || "—"}</td>
                  <td style={td}>{t.is_active
                    ? <span style={{ color: C.success, fontWeight: 700, fontSize: 12 }}>● Active</span>
                    : <span style={{ color: C.danger, fontWeight: 700, fontSize: 12 }}>● Inactive</span>}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditing(t)} style={smallBtn(C.primary)}>Edit</button>
                      <button onClick={() => run(() => apiUpdate("teachers", t.id, { is_active: !t.is_active }), t.is_active ? "Adviser deactivated." : "Adviser reactivated.")}
                        style={smallBtn(t.is_active ? C.danger : C.success)}>{t.is_active ? "Deactivate" : "Activate"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, fontSize: 13, color: C.textMuted }}>
          <span>{total} advisers · page {page + 1} of {pages}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ ...smallBtn(page === 0 ? C.textLight : C.primary), cursor: page === 0 ? "not-allowed" : "pointer" }}>← Prev</button>
            <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} style={{ ...smallBtn(page + 1 >= pages ? C.textLight : C.primary), cursor: page + 1 >= pages ? "not-allowed" : "pointer" }}>Next →</button>
          </div>
        </div>
      )}

      {creating && <AdviserModal sections={sections} onClose={() => setCreating(false)}
        onSave={async (v) => { await run(() => apiInsert("teachers", v), "Adviser added."); setCreating(false); }} />}
      {editing && <AdviserModal initial={editing} sections={sections} onClose={() => setEditing(null)}
        onSave={async (v) => { await run(() => apiUpdate("teachers", editing.id, v), "Adviser updated."); setEditing(null); }} />}
    </div>
  );
}

// ── CSV helpers ───────────────────────────────────────────────────
// Minimal RFC-4180 parser: handles quoted fields, escaped quotes and commas
// inside quotes. Enough for the registrar's exports without pulling in a lib.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

// Header matching is done on a squashed key so "STUDENT NO.", "Student_No"
// and "studentno" all land on the same column (an earlier import bug).
const squash = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUMN_ALIASES = {
  student_no: ["studentno", "studentnumber", "studentid", "idno", "lrn"],
  name: ["name", "studentname", "fullname"],
  level: ["level", "grade", "gradelevel", "yearlevel"],
  section: ["section", "class"],
  gender: ["gender", "sex"],
  program: ["program", "strand", "track"],
  rfid: ["rfid", "rfidtag", "cardno"],
};
function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const k = squash(h);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(k)) { map[field] = i; break; }
    }
  });
  return map;
}

async function upsertStudents(rows) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/students?on_conflict=student_no`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(await res.text());
}

function StudentModal({ initial, onSave, onClose }) {
  const [f, setF] = useState({
    student_no: initial?.student_no || "",
    name: initial?.name || "",
    level: initial?.level || "",
    section: initial?.section || "",
    gender: initial?.gender || "",
    program: initial?.program || "",
    rfid: initial?.rfid || "",
    is_active: initial?.is_active ?? true,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.student_no.trim()) return setErr("Student number is required.");
    if (!f.name.trim()) return setErr("Name is required.");
    setBusy(true); setErr("");
    try {
      await onSave({
        student_no: f.student_no.trim(), name: f.name.trim(),
        level: f.level.trim() || null, section: f.section.trim() || null,
        gender: f.gender.trim() || null, program: f.program.trim() || null,
        rfid: f.rfid.trim() || null, is_active: f.is_active,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit — ${initial.name}` : "New Student"} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={labelStyle()}>Student no.</label><input value={f.student_no} onChange={set("student_no")} style={inputStyle()} /></div>
        <div><label style={labelStyle()}>RFID</label><input value={f.rfid} onChange={set("rfid")} style={inputStyle()} /></div>
      </div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Full name</label>
        <input value={f.name} onChange={set("name")} placeholder="DELA CRUZ, JUAN" style={inputStyle()} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={labelStyle()}>Grade level</label><input value={f.level} onChange={set("level")} placeholder="Grade 9" style={inputStyle()} /></div>
        <div><label style={labelStyle()}>Section</label><input value={f.section} onChange={set("section")} placeholder="Obedience" style={inputStyle()} /></div>
        <div><label style={labelStyle()}>Gender</label><input value={f.gender} onChange={set("gender")} style={inputStyle()} /></div>
        <div><label style={labelStyle()}>Program</label><input value={f.program} onChange={set("program")} style={inputStyle()} /></div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} style={{ width: 16, height: 16 }} />
        Enrolled / active
      </label>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving..." : "Save"}</button>
      </div>
    </Modal>
  );
}

function ImportPanel({ onDone, onClose }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null); // { rows, map, missing }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");

  function analyse(raw) {
    setErr(""); setParsed(null);
    const grid = parseCSV(raw);
    if (grid.length < 2) { setErr("Need a header row plus at least one student."); return; }
    const map = mapHeaders(grid[0]);
    const missing = ["student_no", "name"].filter(k => map[k] === undefined);
    const rows = grid.slice(1).map(r => {
      const o = {};
      for (const [field, idx] of Object.entries(map)) {
        const v = (r[idx] ?? "").trim();
        o[field] = v === "" ? null : v;
      }
      return o;
    }).filter(o => o.student_no && o.name);
    setParsed({ rows, map, missing, detected: Object.keys(map) });
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result)); analyse(String(reader.result)); };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!parsed?.rows.length) return;
    setBusy(true); setErr(""); setProgress("");
    try {
      const CHUNK = 200;
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const batch = parsed.rows.slice(i, i + CHUNK).map(r => ({ ...r, is_active: true }));
        await upsertStudents(batch);
        setProgress(`Imported ${Math.min(i + CHUNK, parsed.rows.length)} of ${parsed.rows.length}...`);
      }
      onDone(`${parsed.rows.length} students imported/updated.`);
    } catch (e) {
      setErr("Import stopped: " + e.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Import students from CSV" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.55, marginBottom: 12 }}>
        Existing students are matched on <strong>student number</strong> and updated; new ones are added.
        Nothing is deleted. Recognised columns: student no., name, level, section, gender, program, rfid.
      </div>
      <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ marginBottom: 10, fontSize: 13 }} />
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 6 }}>…or paste the CSV below</div>
      <textarea value={text} onChange={e => { setText(e.target.value); }} onBlur={() => text && analyse(text)}
        rows={5} placeholder="Student No.,Name,Level,Section&#10;2026001,DELA CRUZ; JUAN,Grade 9,Obedience"
        style={{ ...inputStyle(), fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, resize: "vertical" }} />

      {parsed && (
        <div style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontSize: 13 }}>
          {parsed.missing.length > 0 ? (
            <div style={{ color: C.danger, fontWeight: 600 }}>
              Missing required column{parsed.missing.length > 1 ? "s" : ""}: {parsed.missing.join(", ")}
            </div>
          ) : (
            <>
              <div><strong>{parsed.rows.length}</strong> student rows ready.</div>
              <div style={{ color: C.textMuted, marginTop: 4 }}>Columns detected: {parsed.detected.join(", ")}</div>
            </>
          )}
        </div>
      )}

      {progress && <div style={{ marginTop: 10, fontSize: 13, color: C.primary, fontWeight: 600 }}>{progress}</div>}
      {err && <div style={{ marginTop: 10, fontSize: 13, color: C.danger }}>{err}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={doImport} disabled={busy || !parsed || parsed.missing.length > 0 || !parsed.rows.length}
          style={{ background: (busy || !parsed || parsed.missing?.length) ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? "Importing..." : "Import"}
        </button>
      </div>
    </Modal>
  );
}

function Students() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const headers = await authHeaders();
      const q = search.trim();
      const enc = encodeURIComponent(q);
      const filter = q ? `&or=(name.ilike.*${enc}*,student_no.ilike.*${enc}*,section.ilike.*${enc}*)` : "";
      const from = page * PAGE_SIZE;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/students?select=*&order=name${filter}`,
        { headers: { ...headers, Range: `${from}-${from + PAGE_SIZE - 1}`, Prefer: "count=exact" } });
      if (!res.ok) throw new Error(await res.text());
      setRows(await res.json());
      const cr = res.headers.get("content-range");
      setTotal(cr && cr.includes("/") ? Number(cr.split("/")[1]) || 0 : 0);
    } catch (e) {
      setError("Could not load students: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(0); load(); }, 350); return () => clearTimeout(t); }, [search]);

  function flash(m) { setNotice(m); setTimeout(() => setNotice(""), 4000); }
  async function run(fn, msg) {
    setError("");
    try { await fn(); await load(); flash(msg); }
    catch (e) { setError(e.message); throw e; }
  }

  const td = { padding: "10px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 13, whiteSpace: "nowrap" };
  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, student no. or section..."
          style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, outline: "none", width: 280 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
          <button onClick={() => setImporting(true)} style={{ background: C.card, color: C.primary, border: `1px solid ${C.primary}`, borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>⬆ Import CSV</button>
          <button onClick={() => setCreating(true)} style={{ background: C.primary, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>+ New Student</button>
        </div>
      </div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No students found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: C.bg }}>
              {["Student No.", "Name", "Level & Section", "Status", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(st => (
                <tr key={st.id} style={{ opacity: st.is_active ? 1 : 0.55 }}>
                  <td style={{ ...td, fontFamily: "ui-monospace, Consolas, monospace", color: C.textMuted }}>{st.student_no}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{st.name}</td>
                  <td style={td}>{[st.level, st.section].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={td}>{st.is_active
                    ? <span style={{ color: C.success, fontWeight: 700, fontSize: 12 }}>● Enrolled</span>
                    : <span style={{ color: C.danger, fontWeight: 700, fontSize: 12 }}>● Inactive</span>}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditing(st)} style={smallBtn(C.primary)}>Edit</button>
                      <button onClick={() => run(() => apiUpdate("students", st.id, { is_active: !st.is_active }), st.is_active ? "Student deactivated." : "Student reactivated.")}
                        style={smallBtn(st.is_active ? C.danger : C.success)}>{st.is_active ? "Deactivate" : "Activate"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, fontSize: 13, color: C.textMuted, flexWrap: "wrap", gap: 8 }}>
          <span>{total} students · page {page + 1} of {pages}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ ...smallBtn(page === 0 ? C.textLight : C.primary), cursor: page === 0 ? "not-allowed" : "pointer" }}>← Prev</button>
            <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} style={{ ...smallBtn(page + 1 >= pages ? C.textLight : C.primary), cursor: page + 1 >= pages ? "not-allowed" : "pointer" }}>Next →</button>
          </div>
        </div>
      )}

      {creating && <StudentModal onClose={() => setCreating(false)}
        onSave={async (v) => { await run(() => apiInsert("students", v), "Student added."); setCreating(false); }} />}
      {editing && <StudentModal initial={editing} onClose={() => setEditing(null)}
        onSave={async (v) => { await run(() => apiUpdate("students", editing.id, v), "Student updated."); setEditing(null); }} />}
      {importing && <ImportPanel onClose={() => setImporting(false)}
        onDone={(msg) => { setImporting(false); load(); flash(msg); }} />}
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────
export default function Directory() {
  const [tab, setTab] = useState("advisers");
  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" };

  return (
    <div style={panel}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Directory</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14 }}>Advisers and students used by the kiosk.</div>

      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, width: "fit-content", marginBottom: 16 }}>
        {[["advisers", "Advisers"], ["students", "Students"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ background: tab === id ? C.primary : C.card, color: tab === id ? "#fff" : C.textMuted, border: "none", padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {tab === "advisers" ? <Advisers /> : <Students />}
    </div>
  );
}
