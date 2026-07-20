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

function AdviserModal({ initial, onSave, onClose }) {
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
          The kiosk matches a student's grade level and section to find their adviser, so students don't pick a name. Fill both in to enable that.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={labelStyle()}>Grade level</label><input value={f.level} onChange={set("level")} placeholder="e.g. Grade 9" style={inputStyle()} /></div>
          <div><label style={labelStyle()}>Section</label><input value={f.section} onChange={set("section")} placeholder="e.g. Obedience" style={inputStyle()} /></div>
        </div>
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

      {creating && <AdviserModal onClose={() => setCreating(false)}
        onSave={async (v) => { await run(() => apiInsert("teachers", v), "Adviser added."); setCreating(false); }} />}
      {editing && <AdviserModal initial={editing} onClose={() => setEditing(null)}
        onSave={async (v) => { await run(() => apiUpdate("teachers", editing.id, v), "Adviser updated."); setEditing(null); }} />}
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

      {tab === "advisers" ? <Advisers /> : (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.textMuted, background: C.bg, borderRadius: 10, border: `1px dashed ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Student management is coming next</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            With 2,000+ students this screen needs search, paging and CSV import to be useful — it's the next piece of work.
          </div>
        </div>
      )}
    </div>
  );
}
