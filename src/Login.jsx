import { useState } from "react";
import { supabase } from "./supabaseClient";
import { C, T } from "./theme";


const ALLOWED_DOMAIN = "@adi.edu.ph";

export default function Login({ onBack, message }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");

    // Enforce school email domain
    if (!email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      setError(`Please use your school email ending in ${ALLOWED_DOMAIN}`);
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);

    if (authError) {
      setError("Invalid email or password. Please try again.");
    }
    // On success, the auth state listener in App.jsx handles redirect
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleLogin();
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: T.font.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.card, borderRadius: 16, padding: "40px 40px", width: "100%", maxWidth: 420, boxShadow: "0 10px 40px rgba(15,23,42,0.1)", border: `1px solid ${C.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "inline-flex", width: 48, height: 48, background: C.primary, borderRadius: "50%", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 15, marginBottom: 12 }}>POD</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Staff Login</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Discipline Office — Admission Slip System</div>
        </div>

        {message && (
          <div style={{ background: "rgba(245,158,11,0.1)", border: `1px solid ${C.warning}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.text, marginBottom: 16 }}>
            {message}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>School Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="you@adi.edu.ph"
            autoFocus
            style={{ width: "100%", background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 15, color: C.text, outline: "none", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, display: "block" }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your password"
            style={{ width: "100%", background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 15, color: C.text, outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${C.danger}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: C.danger, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button onClick={handleLogin} disabled={loading}
          style={{ width: "100%", background: loading ? C.textLight : C.primary, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginBottom: 12 }}>
          {loading ? "Signing in..." : "Sign In"}
        </button>

        <button onClick={onBack}
          style={{ width: "100%", background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          ← Back to Check-In
        </button>
      </div>
    </div>
  );
}
