import { useState } from "react";

const SUPABASE_URL = "https://ghofeoxrkrcibzeqcbih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2Zlb3hya3JjaWJ6ZXFjYmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTI4MTIsImV4cCI6MjA5ODIyODgxMn0.RsFkrqiuv4CzXGRg2FP33nTj5dMUtD2aF8w5NQYtmKQ";

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("");

  async function doSearch() {
    setStatus("Searching...");
    setResults([]);
    try {
      // Use aliases to rename problematic columns
      const selectParam = 'name:NAME,student_no:"STUDENT NO.",level:LEVEL,section:SECTION,rfid:RFID';
      const url = `${SUPABASE_URL}/rest/v1/students?select=${encodeURIComponent(selectParam)}&limit=3000`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      setStatus(`HTTP ${res.status}`);
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Error ${res.status}: ${text}`);
        return;
      }
      const data = await res.json();
      const q = query.toLowerCase();
      const filtered = data.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.student_no || "").toLowerCase().includes(q)
      );
      setStatus(`Loaded ${data.length} students. Found ${filtered.length} matches.`);
      setResults(filtered.slice(0, 10));
    } catch (e) {
      setStatus("Fetch error: " + e.message);
    }
  }

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif", background: "#0f172a", color: "#fff", minHeight: "100vh" }}>
      <h1>Student Search Test</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type then click Search"
        style={{ padding: 12, fontSize: 16, width: 300, marginRight: 10 }}
      />
      <button onClick={doSearch} style={{ padding: 12, fontSize: 16 }}>
        Search
      </button>
      <div style={{ marginTop: 20, fontWeight: "bold", color: "#fbbf24" }}>
        Status: {status}
      </div>
      <ul style={{ marginTop: 20 }}>
        {results.map((r, i) => (
          <li key={i}>
            {r.name} — {r.student_no} ({r.level} - {r.section})
          </li>
        ))}
      </ul>
    </div>
  );
}
