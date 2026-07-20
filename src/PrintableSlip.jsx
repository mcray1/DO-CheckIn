// Official admission slip, print-optimized (clean, black-on-white friendly).
// Hidden on screen via the .print-only class and revealed only when printing;
// the #printable-slip id is what the @media print block in index.css isolates.
// Shared by the kiosk (preliminary slip) and the dashboard (final confirmed slip).

function Row({ label, value }) {
  return (
    <tr>
      <td style={{ padding: "5px 14px 5px 0", color: "#555", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", verticalAlign: "top", letterSpacing: 0.4 }}>{label}</td>
      <td style={{ padding: "5px 0", fontSize: 13, fontWeight: 600, color: "#111", borderBottom: "1px solid #ccc" }}>{value || "—"}</td>
    </tr>
  );
}

export default function PrintableSlip({ slip }) {
  const {
    name, student_id, grade_section, date, time_arrived, teacher_name,
    absence_date, nature, meridiem, reason, sub_category, status,
    document_required, document_status, document_deadline, confirmed_by,
  } = slip;

  return (
    <div id="printable-slip" className="print-only">
      <div style={{ maxWidth: 580, margin: "0 auto", fontFamily: "Arial, Helvetica, sans-serif", color: "#111" }}>
        <div style={{ textAlign: "center", borderBottom: "2px solid #1e40af", paddingBottom: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "#444" }}>ATENEO DE ILOILO – SANTA MARIA CATHOLIC SCHOOL</div>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>DISCIPLINE OFFICE</div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2, color: "#1e40af" }}>ADMISSION SLIP</div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
          <tbody>
            <Row label="Name" value={name} />
            <Row label="Student ID" value={student_id} />
            <Row label="Gr. & Sec." value={grade_section} />
            <Row label="Date" value={date} />
            <Row label="Time Arrived" value={time_arrived} />
            {absence_date && <Row label="Date Absent" value={absence_date} />}
            <Row label="Teacher" value={teacher_name} />
            <Row label="Nature" value={[nature, meridiem].filter(Boolean).join("  ")} />
            <Row label="Reason" value={reason} />
            <Row label="Category" value={sub_category} />
            <Row label="Status" value={status || "Pending — for POD confirmation"} />
            {document_required && (
              <Row label="Document" value={`${document_status || "Promised"}${document_deadline ? ` — by ${document_deadline}` : ""}`} />
            )}
            <Row label="Confirmed by" value={confirmed_by} />
          </tbody>
        </table>

        <div style={{ marginTop: 48, textAlign: "center", fontSize: 11, color: "#333" }}>
          _______________________________________<br />
          <span style={{ fontWeight: 700 }}>Prefect of Discipline / Discipline Officer</span>
        </div>
      </div>
    </div>
  );
}
