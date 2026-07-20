import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { C } from "./theme";

// Admin-only manager for the kiosk's decision data:
//   Nature of Visit (categories) -> Sub-categories -> Keywords (classifier).
// Reads are public; writes are gated to admins by RLS (20260717 migration).
// "Removing" a category / sub-category = deactivate (keeps historical slips
// intact); keywords are not referenced by slips, so they can be hard-deleted.


const STATUS_OPTIONS = ["Excused", "Unexcused", "Admit Temporarily"];
const statusColors = { Excused: C.success, Unexcused: C.danger, "Admit Temporarily": C.warning };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function apiGet(path) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
async function apiDelete(table, id) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(await res.text());
}

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

// ── shared bits ───────────────────────────────────────────────────
function labelStyle() {
  return { fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" };
}
function inputStyle() {
  return { width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" };
}
function Badge({ text, color = C.primary, bg = C.primaryBg }) {
  return <span style={{ background: bg, color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{text}</span>;
}
function smallBtn(fg, bd = null) {
  return { background: C.card, color: fg, border: bd || `1px solid ${fg}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
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
function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: C.text, cursor: "pointer", marginBottom: 10 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
      {label}
    </label>
  );
}
function Actions({ children }) {
  return <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>{children}</div>;
}
function CancelBtn({ onClick }) {
  return <button onClick={onClick} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>;
}
function SaveBtn({ onClick, busy, label = "Save" }) {
  return <button onClick={onClick} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving..." : label}</button>;
}

// ── modals ────────────────────────────────────────────────────────
function CategoryModal({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [requiresReason, setRequiresReason] = useState(initial?.requires_reason ?? true);
  const [requiresTeacher, setRequiresTeacher] = useState(initial?.requires_teacher ?? false);
  const [hasSubs, setHasSubs] = useState(initial?.has_sub_categories ?? true);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setErr("Name is required.");
    setBusy(true); setErr("");
    try {
      await onSave({
        name: name.trim(), description: description.trim() || null,
        requires_reason: requiresReason, requires_teacher: requiresTeacher,
        has_sub_categories: hasSubs, is_active: isActive, sort_order: Number(sortOrder) || 0,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit — ${initial.name}` : "New Nature of Visit"} onClose={onClose}>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Late" style={inputStyle()} /></div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Description (optional)</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short note shown on hover" style={inputStyle()} /></div>
      <Checkbox label="Requires a reason / explanation" checked={requiresReason} onChange={setRequiresReason} />
      <Checkbox label="Requires selecting an adviser" checked={requiresTeacher} onChange={setRequiresTeacher} />
      <Checkbox label="Has sub-categories" checked={hasSubs} onChange={setHasSubs} />
      <Checkbox label="Active (shown on the kiosk)" checked={isActive} onChange={setIsActive} />
      <div style={{ marginBottom: 14 }}><label style={labelStyle()}>Sort order</label>
        <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={{ ...inputStyle(), width: 120 }} /></div>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <Actions><CancelBtn onClick={onClose} /><SaveBtn onClick={save} busy={busy} /></Actions>
    </Modal>
  );
}

function SubCategoryModal({ initial, categoryName, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [status, setStatus] = useState(initial?.suggested_status || "Admit Temporarily");
  const [docRequired, setDocRequired] = useState(initial?.document_required ?? false);
  const [docDesc, setDocDesc] = useState(initial?.document_description || "");
  const [docDays, setDocDays] = useState(initial?.document_deadline_days ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setErr("Name is required.");
    setBusy(true); setErr("");
    try {
      await onSave({
        name: name.trim(), suggested_status: status,
        document_required: docRequired,
        document_description: docRequired ? (docDesc.trim() || null) : null,
        document_deadline_days: docRequired && docDays !== "" ? Number(docDays) : null,
        is_active: isActive, sort_order: Number(sortOrder) || 0,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit sub-category — ${initial.name}` : `New sub-category · ${categoryName}`} onClose={onClose}>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Traffic" style={inputStyle()} /></div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Suggested status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle(), background: C.card }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select></div>
      <Checkbox label="Requires a supporting document" checked={docRequired} onChange={setDocRequired} />
      {docRequired && (
        <div style={{ paddingLeft: 24, marginBottom: 6 }}>
          <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Document description</label>
            <input value={docDesc} onChange={e => setDocDesc(e.target.value)} placeholder="e.g. Medical certificate" style={inputStyle()} /></div>
          <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Deadline (days from filing)</label>
            <input type="number" min={0} value={docDays} onChange={e => setDocDays(e.target.value)} placeholder="e.g. 3" style={{ ...inputStyle(), width: 140 }} /></div>
        </div>
      )}
      <Checkbox label="Active" checked={isActive} onChange={setIsActive} />
      <div style={{ marginBottom: 14 }}><label style={labelStyle()}>Sort order</label>
        <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={{ ...inputStyle(), width: 120 }} /></div>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <Actions><CancelBtn onClick={onClose} /><SaveBtn onClick={save} busy={busy} /></Actions>
    </Modal>
  );
}

function KeywordModal({ initial, categoryName, onSave, onClose }) {
  const [keyword, setKeyword] = useState(initial?.keyword || "");
  // nature must equal the parent category name (or "Any") or the classifier skips it.
  const [nature, setNature] = useState(initial?.nature || categoryName);
  const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [status, setStatus] = useState(initial?.suggested_status || "Admit Temporarily");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!keyword.trim()) return setErr("Keyword is required.");
    setBusy(true); setErr("");
    try {
      await onSave({
        keyword: keyword.trim().toLowerCase(), nature,
        weight: Number(weight) || 1, suggested_status: status, is_active: isActive,
      });
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit keyword` : `New keyword`} onClose={onClose}>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        The classifier matches when a student's reason <em>contains</em> this text (case-insensitive). Higher weight = stronger pull toward this sub-category.
      </div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Keyword / phrase</label>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. traffic" style={inputStyle()} /></div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><label style={labelStyle()}>Applies to</label>
          <select value={nature} onChange={e => setNature(e.target.value)} style={{ ...inputStyle(), background: C.card }}>
            <option value={categoryName}>{categoryName}</option>
            <option value="Any">Any category</option>
          </select></div>
        <div style={{ width: 110 }}><label style={labelStyle()}>Weight</label>
          <input type="number" min={1} value={weight} onChange={e => setWeight(e.target.value)} style={inputStyle()} /></div>
      </div>
      <div style={{ marginBottom: 12 }}><label style={labelStyle()}>Suggested status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle(), background: C.card }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select></div>
      <Checkbox label="Active" checked={isActive} onChange={setIsActive} />
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <Actions><CancelBtn onClick={onClose} /><SaveBtn onClick={save} busy={busy} /></Actions>
    </Modal>
  );
}

// ── main ──────────────────────────────────────────────────────────
export default function Categories() {
  const [cats, setCats] = useState([]);
  const [subs, setSubs] = useState([]);
  const [kws, setKws] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openCats, setOpenCats] = useState(() => new Set());
  const [openSubs, setOpenSubs] = useState(() => new Set());
  const [modal, setModal] = useState(null); // { kind, initial, parent }

  async function load() {
    setLoading(true); setError("");
    try {
      const [c, s, k] = await Promise.all([
        apiGet("categories?select=id,name,description,requires_reason,requires_teacher,has_sub_categories,is_active,sort_order"),
        apiGet("sub_categories?select=id,category_id,name,suggested_status,document_required,document_description,document_deadline_days,is_active,sort_order"),
        apiGet("keywords?select=id,nature,sub_category_id,keyword,suggested_status,weight,is_active"),
      ]);
      setCats(c); setSubs(s); setKws(k);
    } catch (e) {
      setError("Could not load: " + e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(""), 3500); }
  function toggle(set, setter, id) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  async function run(fn, okMsg) {
    setError("");
    try { await fn(); await load(); flash(okMsg); }
    catch (e) { setError(e.message); throw e; }
  }

  const subsOf = (catId) => subs.filter(s => s.category_id === catId).sort(bySort);
  const kwsOf = (subId) => kws.filter(k => k.sub_category_id === subId).sort((a, b) => a.keyword.localeCompare(b.keyword));
  const nextSort = (arr) => (arr.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0) + 1);

  const panel = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" };

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Nature of Visit &amp; Rules</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Manage categories, their sub-categories, and the keywords that drive the classifier. Changes apply the next time the kiosk is loaded.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
          <button onClick={() => setModal({ kind: "category", initial: null })} style={{ background: C.primary, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>+ New Category</button>
        </div>
      </div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, margin: "12px 0" }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, margin: "12px 0" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading...</div>
      ) : cats.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>No categories yet. Add the first one.</div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {[...cats].sort(bySort).map(cat => {
            const catSubs = subsOf(cat.id);
            const open = openCats.has(cat.id);
            return (
              <div key={cat.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, opacity: cat.is_active ? 1 : 0.6 }}>
                {/* Category row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => toggle(openCats, setOpenCats, cat.id)}>
                    <span style={{ color: C.textLight, fontSize: 12, width: 12 }}>{open ? "▼" : "▶"}</span>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{cat.name}</span>
                    <span style={{ fontSize: 12, color: C.textMuted }}>{catSubs.length} sub</span>
                    {cat.requires_teacher && <Badge text="teacher" />}
                    {cat.requires_reason && <Badge text="reason" />}
                    {!cat.is_active && <Badge text="Inactive" color={C.danger} bg="rgba(239,68,68,0.12)" />}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setModal({ kind: "category", initial: cat })} style={smallBtn(C.primary)}>Edit</button>
                    <button onClick={() => run(() => apiUpdate("categories", cat.id, { is_active: !cat.is_active }), cat.is_active ? "Category deactivated." : "Category reactivated.")}
                      style={smallBtn(cat.is_active ? C.danger : C.success)}>{cat.is_active ? "Deactivate" : "Activate"}</button>
                  </div>
                </div>

                {/* Sub-categories */}
                {open && (
                  <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg, padding: "10px 14px 14px 26px" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                      <button onClick={() => setModal({ kind: "subcategory", initial: null, parent: cat })} style={{ ...smallBtn(C.primary), background: C.card }}>+ Add sub-category</button>
                    </div>
                    {catSubs.length === 0 ? (
                      <div style={{ fontSize: 13, color: C.textLight, padding: "6px 0" }}>No sub-categories yet.</div>
                    ) : catSubs.map(sub => {
                      const subKws = kwsOf(sub.id);
                      const subOpen = openSubs.has(sub.id);
                      return (
                        <div key={sub.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, marginBottom: 8, opacity: sub.is_active ? 1 : 0.6 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => toggle(openSubs, setOpenSubs, sub.id)}>
                              <span style={{ color: C.textLight, fontSize: 11, width: 10 }}>{subOpen ? "▼" : "▶"}</span>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{sub.name}</span>
                              <Badge text={sub.suggested_status} color={statusColors[sub.suggested_status] || C.textMuted} bg={`${statusColors[sub.suggested_status] || C.textMuted}18`} />
                              {sub.document_required && <Badge text="📄 doc" color={C.warning} bg="rgba(245,158,11,0.12)" />}
                              <span style={{ fontSize: 12, color: C.textMuted }}>{subKws.length} kw</span>
                              {!sub.is_active && <Badge text="Inactive" color={C.danger} bg="rgba(239,68,68,0.12)" />}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => setModal({ kind: "subcategory", initial: sub, parent: cat })} style={smallBtn(C.primary)}>Edit</button>
                              <button onClick={() => run(() => apiUpdate("sub_categories", sub.id, { is_active: !sub.is_active }), sub.is_active ? "Sub-category deactivated." : "Sub-category reactivated.")}
                                style={smallBtn(sub.is_active ? C.danger : C.success)}>{sub.is_active ? "Deactivate" : "Activate"}</button>
                            </div>
                          </div>

                          {/* Keywords */}
                          {subOpen && (
                            <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px 12px 24px" }}>
                              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                                <button onClick={() => setModal({ kind: "keyword", initial: null, parent: sub, category: cat })} style={{ ...smallBtn(C.primary), background: C.bg }}>+ Add keyword</button>
                              </div>
                              {subKws.length === 0 ? (
                                <div style={{ fontSize: 13, color: C.textLight, padding: "4px 0" }}>No keywords — the classifier can't auto-suggest this sub-category.</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {subKws.map(kw => (
                                    <div key={kw.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 10px", background: C.bg, borderRadius: 6, opacity: kw.is_active ? 1 : 0.55 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <span style={{ fontWeight: 700, fontSize: 13 }}>"{kw.keyword}"</span>
                                        <span style={{ fontSize: 11, color: C.textMuted }}>×{kw.weight}</span>
                                        <Badge text={kw.suggested_status} color={statusColors[kw.suggested_status] || C.textMuted} bg={`${statusColors[kw.suggested_status] || C.textMuted}14`} />
                                        {kw.nature === "Any" && <Badge text="Any" color={C.textMuted} bg={C.border} />}
                                        {!kw.is_active && <Badge text="off" color={C.danger} bg="rgba(239,68,68,0.12)" />}
                                      </div>
                                      <div style={{ display: "flex", gap: 6 }}>
                                        <button onClick={() => setModal({ kind: "keyword", initial: kw, parent: sub, category: cat })} style={smallBtn(C.primary)}>Edit</button>
                                        <button onClick={() => { if (window.confirm(`Delete keyword "${kw.keyword}"? This can't be undone.`)) run(() => apiDelete("keywords", kw.id), "Keyword deleted."); }}
                                          style={smallBtn(C.danger)}>Delete</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {modal?.kind === "category" && (
        <CategoryModal initial={modal.initial} onClose={() => setModal(null)}
          onSave={async (values) => {
            if (modal.initial) await run(() => apiUpdate("categories", modal.initial.id, values), "Category updated.");
            else await run(() => apiInsert("categories", { ...values, sort_order: values.sort_order || nextSort(cats) }), "Category added.");
            setModal(null);
          }} />
      )}
      {modal?.kind === "subcategory" && (
        <SubCategoryModal initial={modal.initial} categoryName={modal.parent.name} onClose={() => setModal(null)}
          onSave={async (values) => {
            if (modal.initial) await run(() => apiUpdate("sub_categories", modal.initial.id, values), "Sub-category updated.");
            else await run(() => apiInsert("sub_categories", { ...values, category_id: modal.parent.id, sort_order: values.sort_order || nextSort(subsOf(modal.parent.id)) }), "Sub-category added.");
            setModal(null);
          }} />
      )}
      {modal?.kind === "keyword" && (
        <KeywordModal initial={modal.initial} categoryName={modal.category.name} onClose={() => setModal(null)}
          onSave={async (values) => {
            if (modal.initial) await run(() => apiUpdate("keywords", modal.initial.id, values), "Keyword updated.");
            else await run(() => apiInsert("keywords", { ...values, sub_category_id: modal.parent.id }), "Keyword added.");
            setModal(null);
          }} />
      )}
    </div>
  );
}
