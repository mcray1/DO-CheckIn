import { useState, useEffect } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";

const C = {
  primary: "#1e40af", primaryLight: "#3b82f6", primaryBg: "#dbeafe",
  bg: "#f1f5f9", card: "#ffffff", text: "#1e293b",
  textMuted: "#64748b", textLight: "#94a3b8", border: "#e2e8f0",
  success: "#10b981", warning: "#f59e0b", danger: "#ef4444",
};

const ROLE_LABELS = { superadmin: "Super Admin", pod_admin: "Admin", pod_staff: "Staff", faculty: "Faculty" };
const RANK = { superadmin: 3, pod_admin: 2, pod_staff: 1, faculty: 0 };
const ALLOWED_DOMAIN = "@adi.edu.ph";
const MIN_PASSWORD = 8;

// Roles a caller may assign (faculty deliberately excluded for now — future provision).
function assignableRoles(callerRole) {
  const rank = RANK[callerRole] ?? -1;
  return [
    ["pod_admin", "Admin"],
    ["pod_staff", "Staff"],
  ].filter(([r]) => RANK[r] < rank);
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

async function fetchUsers() {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,email,role,is_active,must_change_password,created_at&order=created_at.asc`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function callManageUsers(action, payload) {
  const headers = await authHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-users`, {
    method: "POST", headers, body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Users({ profile }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);

  const roleOptions = assignableRoles(profile.role);
  const callerRank = RANK[profile.role] ?? -1;
  const canManage = (u) => u.id !== profile.id && (RANK[u.role] ?? 99) < callerRank;

  async function load() {
    setLoading(true); setError("");
    try { setUsers(await fetchUsers()); }
    catch (e) { setError("Could not load users: " + e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function flash(msg) { setNotice(msg); setTimeout(() => setNotice(""), 4000); }

  async function doAction(action, payload, okMsg) {
    setError("");
    try {
      await callManageUsers(action, payload);
      flash(okMsg);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  const s = {
    panel: { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.04)" },
    th: { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" },
    td: { padding: "12px", borderBottom: `1px solid ${C.border}`, fontSize: 13, whiteSpace: "nowrap" },
    smallBtn: (bg, fg, bd) => ({ background: bg, color: fg, border: bd, borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }),
  };

  return (
    <div style={s.panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>User Accounts</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔄</button>
          {roleOptions.length > 0 && (
            <button onClick={() => { setShowCreate(v => !v); setError(""); }} style={{ background: C.primary, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>
              {showCreate ? "Close" : "+ New User"}
            </button>
          )}
        </div>
      </div>

      {notice && <div style={{ background: "rgba(16,185,129,0.1)", border: `1px solid ${C.success}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, marginBottom: 12 }}>✓ {notice}</div>}
      {error && <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 12 }}>{error}</div>}

      {showCreate && roleOptions.length > 0 && (
        <CreateForm roleOptions={roleOptions}
          onCancel={() => setShowCreate(false)}
          onSubmit={async (payload) => {
            const ok = await doAction("create", payload, `Created ${payload.email}. Share the temp password — they'll be asked to change it on first login.`);
            if (ok) setShowCreate(false);
          }} />
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textLight }}>Loading users...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Name", "Email", "Role", "Status", "Actions"].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === profile.id;
                const manageable = canManage(u);
                return (
                  <tr key={u.id}>
                    <td style={s.td}>
                      <span style={{ fontWeight: 600 }}>{u.full_name || "—"}</span>
                      {isSelf && <span style={{ marginLeft: 6, fontSize: 11, color: C.primary, fontWeight: 700 }}>(you)</span>}
                    </td>
                    <td style={{ ...s.td, color: C.textMuted }}>{u.email}</td>
                    <td style={s.td}>
                      <span style={{ background: C.primaryBg, color: C.primary, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{ROLE_LABELS[u.role] || u.role}</span>
                    </td>
                    <td style={s.td}>
                      {u.is_active
                        ? <span style={{ color: C.success, fontWeight: 700, fontSize: 12 }}>● Active</span>
                        : <span style={{ color: C.danger, fontWeight: 700, fontSize: 12 }}>● Inactive</span>}
                      {u.must_change_password && <span style={{ marginLeft: 8, fontSize: 11, color: C.warning, fontWeight: 600 }}>temp pw</span>}
                    </td>
                    <td style={s.td}>
                      {manageable ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setEditing(u)} style={s.smallBtn(C.card, C.primary, `1px solid ${C.primary}`)}>Edit</button>
                          <button onClick={() => doAction("set_active", { id: u.id, is_active: !u.is_active }, u.is_active ? "User deactivated." : "User reactivated.")}
                            style={s.smallBtn(C.card, u.is_active ? C.danger : C.success, `1px solid ${u.is_active ? C.danger : C.success}`)}>
                            {u.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button onClick={() => setResetting(u)} style={s.smallBtn(C.bg, C.textMuted, `1px solid ${C.border}`)}>Reset PW</button>
                        </div>
                      ) : (
                        <span style={{ color: C.textLight, fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: "30px 0", color: C.textLight }}>No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal user={editing} roleOptions={roleOptions}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            const ok = await doAction("update", { id: editing.id, ...payload }, "User updated.");
            if (ok) setEditing(null);
          }} />
      )}

      {resetting && (
        <ResetModal user={resetting}
          onClose={() => setResetting(null)}
          onSave={async (password) => {
            const ok = await doAction("reset_password", { id: resetting.id, password }, "Temp password set. Share it — the user changes it on next login.");
            if (ok) setResetting(null);
          }} />
      )}
    </div>
  );
}

function labelStyle() {
  return { fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" };
}
function inputStyle() {
  return { width: "100%", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" };
}

function CreateForm({ roleOptions, onSubmit, onCancel }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roleOptions[0][0]);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    if (!fullName.trim()) return setErr("Full name is required.");
    if (!email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN)) return setErr(`Email must end in ${ALLOWED_DOMAIN}.`);
    if (password.length < MIN_PASSWORD) return setErr(`Temp password must be at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    await onSubmit({ full_name: fullName.trim(), email: email.trim().toLowerCase(), role, password });
    setBusy(false);
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, background: C.bg }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>New User</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle()}>Full Name</label>
          <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Juan Dela Cruz" style={inputStyle()} />
        </div>
        <div>
          <label style={labelStyle()}>School Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder={`name${ALLOWED_DOMAIN}`} style={inputStyle()} />
        </div>
        <div>
          <label style={labelStyle()}>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)} style={{ ...inputStyle(), background: C.card }}>
            {roleOptions.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle()}>Temporary Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" style={inputStyle()} />
        </div>
      </div>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={submit} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Creating..." : "Create User"}</button>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: C.card, borderRadius: 14, padding: "24px 28px", width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: C.textLight, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditModal({ user, roleOptions, onSave, onClose }) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [role, setRole] = useState(user.role);
  const [busy, setBusy] = useState(false);
  // Only offer role changes among assignable roles; if the user's current role
  // isn't assignable by this caller it still shows but stays selected.
  const options = roleOptions.some(([r]) => r === user.role) ? roleOptions : [[user.role, ROLE_LABELS[user.role] || user.role], ...roleOptions];

  async function save() {
    setBusy(true);
    await onSave({ full_name: fullName.trim(), role });
    setBusy(false);
  }

  return (
    <Modal title={`Edit — ${user.email}`} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle()}>Full Name</label>
        <input value={fullName} onChange={e => setFullName(e.target.value)} style={inputStyle()} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle()}>Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} style={{ ...inputStyle(), background: C.card }}>
          {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving..." : "Save"}</button>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onSave, onClose }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (password.length < MIN_PASSWORD) return setErr(`Temp password must be at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    await onSave(password);
    setBusy(false);
  }

  return (
    <Modal title={`Reset Password — ${user.email}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Set a temporary password. The user will be required to change it the next time they log in.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle()}>Temporary Password</label>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" style={inputStyle()} />
      </div>
      {err && <div style={{ fontSize: 13, color: C.danger, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ background: busy ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Saving..." : "Set Password"}</button>
      </div>
    </Modal>
  );
}
