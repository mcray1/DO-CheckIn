import { useState } from "react";
import { supabase } from "./supabaseClient";
import { C, T } from "./theme";


const MIN_PASSWORD = 8;

// Mandatory password change shown on first login (profile.must_change_password).
// Changes the password via the native auth client, then clears the flag with a
// security-definer RPC. onDone() lets the app drop the user into the dashboard.
export default function ChangePassword({ profile, onDone, onSignOut }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) {
      setLoading(false);
      setError(pwError.message || "Could not update password. Please try again.");
      return;
    }
    // Password changed — clear the forced-change flag. If this fails the user is
    // simply prompted again next login; the password change already succeeded.
    await supabase.rpc("clear_my_password_flag");
    setLoading(false);
    onDone();
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSubmit();
  }

  const strong = password.length >= MIN_PASSWORD;
  const match = confirm.length > 0 && password === confirm;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: T.font.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.card, borderRadius: 16, padding: "40px 40px", width: "100%", maxWidth: 440, boxShadow: "0 10px 40px rgba(15,23,42,0.1)", border: `1px solid ${C.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", width: 48, height: 48, background: C.primary, borderRadius: "50%", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 15, marginBottom: 12 }}>POD</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Set a New Password</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6, lineHeight: 1.5 }}>
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}. For security, please replace your temporary password before continuing.
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>New Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} placeholder="At least 8 characters" autoFocus
            style={{ width: "100%", background: C.card, border: `1.5px solid ${strong ? C.success : C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 15, color: C.text, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>Confirm Password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={handleKeyDown} placeholder="Re-enter the new password"
            style={{ width: "100%", background: C.card, border: `1.5px solid ${confirm.length > 0 ? (match ? C.success : C.danger) : C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 15, color: C.text, outline: "none", boxSizing: "border-box" }} />
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading}
          style={{ width: "100%", background: loading ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginBottom: 12 }}>
          {loading ? "Saving..." : "Save & Continue"}
        </button>

        <button onClick={onSignOut}
          style={{ width: "100%", background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
