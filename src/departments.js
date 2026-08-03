// School departments, derived from a slip's grade level.
//
// Slips only carry `grade_section` text ("Grade 9 - Obedience"), so the
// department is computed rather than stored — that way it stays correct for
// slips filed before this existed, and nothing needs backfilling.
//
// Levels actually present in the roster: Kinder, Prep, Grade 1–12.

export const DEPARTMENTS = ["PS/GS", "JHS", "SHS"];

// "Grade 9 - Obedience" -> "Grade 9"
export function levelOf(gradeSection) {
  const gs = String(gradeSection || "").trim();
  return gs ? gs.split(" - ")[0].trim() : "";
}

// -> "PS/GS" | "JHS" | "SHS" | "Unassigned"
export function departmentOf(gradeSection) {
  const lv = levelOf(gradeSection).toLowerCase();
  if (!lv) return "Unassigned";

  const num = lv.match(/(\d+)/);
  if (num) {
    const n = Number(num[1]);
    if (n >= 11) return "SHS";   // Grades 11–12
    if (n >= 7) return "JHS";    // Grades 7–10
    if (n >= 1) return "PS/GS";  // Grades 1–6
  }
  // Pre-elementary levels carry no number.
  if (/kinder|prep|nursery|casa|toddler|pre-?school/.test(lv)) return "PS/GS";
  return "Unassigned";
}
