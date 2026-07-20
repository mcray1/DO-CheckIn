// Design tokens — Apple-style structure (type scale, 8px spacing, flat surfaces,
// restrained elevation, 44px touch targets) carrying Ateneo de Iloilo's colours.
//
// `C` keeps the key names the components already use, so importing it re-skins
// every existing inline style without rewriting them. Prefer `T` for new code.

const navy = "#12315B";   // Ateneo navy — brand chrome + primary actions
const gold = "#C8A24B";   // Ateneo gold — accent only, never body text

export const T = {
  color: {
    // Brand
    navy,
    navyHover: "#1A4275",
    navyActive: "#0C2444",
    gold,
    goldSoft: "#F5EDDB",
    link: "#1F5FA9",         // lighter Ateneo blue: legible on white for links

    // Text (Apple neutral scale)
    text: "#1D1D1F",
    textSecondary: "#333336",
    textMuted: "#6E6E73",
    textLight: "#86868B",

    // Surfaces & lines
    surface: "#FFFFFF",
    surfaceAlt: "#F5F5F7",
    tint: "#EAF1FA",         // navy at low opacity, for selected states
    border: "#E5E5E7",       // dividers, table rows
    borderStrong: "#D2D2D7", // inputs, controls

    // Semantic (Apple-calibrated, AA on white)
    success: "#248A3D",
    warning: "#B25000",
    danger: "#D70015",
  },

  font: {
    text: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, Roboto, sans-serif`,
    display: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, Roboto, sans-serif`,
  },

  // Weight before size for hierarchy; body never below 12px.
  type: {
    display: { fontSize: 40, lineHeight: "44px", fontWeight: 600 },
    h1:      { fontSize: 34, lineHeight: "41px", fontWeight: 600 },
    h2:      { fontSize: 28, lineHeight: "32px", fontWeight: 600 },
    h3:      { fontSize: 24, lineHeight: "28px", fontWeight: 600 },
    body:    { fontSize: 17, lineHeight: "25px", fontWeight: 400 },
    label:   { fontSize: 14, lineHeight: "18px", fontWeight: 400 },
    caption: { fontSize: 12, lineHeight: "16px", fontWeight: 400 },
  },

  // 8px base unit.
  space: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40, xxxl: 48 },

  radius: { none: 0, sm: 4, md: 8, circle: "50%" },

  // Shadows are rare and soft; most surfaces stay flat.
  elevation: {
    none: "none",
    sm: "0 2px 8px rgba(0, 0, 0, 0.10)",
    md: "0 4px 16px rgba(0, 0, 0, 0.12)",
    lg: "0 8px 32px rgba(0, 0, 0, 0.15)",
  },

  touch: 44, // minimum interactive height
  focusRing: `0 0 0 3px rgba(31, 95, 169, 0.20)`,
};

// Back-compatible palette: same keys the components already reference.
export const C = {
  primary: T.color.navy,
  primaryLight: T.color.link,
  primaryBg: T.color.tint,
  bg: T.color.surfaceAlt,
  card: T.color.surface,
  text: T.color.text,
  textMuted: T.color.textMuted,
  textLight: T.color.textLight,
  border: T.color.border,
  success: T.color.success,
  warning: T.color.warning,
  danger: T.color.danger,
  // extras for new code
  accent: T.color.gold,
  borderStrong: T.color.borderStrong,
};

export const NAVY = T.color.navy;
export const GOLD = T.color.gold;

// School seal, served from public/. BASE_URL keeps it correct under the /pod/ subpath.
export const SEAL_SRC = import.meta.env.BASE_URL + "seal.png";

// ── Style helpers ────────────────────────────────────────────────
// Buttons meet the 44px touch target and use the 8px radius.
export function button(variant = "primary", opts = {}) {
  const base = {
    minHeight: T.touch,
    padding: "12px 20px",
    borderRadius: T.radius.md,
    fontFamily: T.font.text,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: "20px",
    cursor: opts.disabled ? "not-allowed" : "pointer",
    boxShadow: "none",
    transition: "background-color 180ms ease, border-color 180ms ease, color 180ms ease",
    boxSizing: "border-box",
  };
  if (variant === "primary") {
    return { ...base, background: opts.disabled ? T.color.borderStrong : T.color.navy,
      color: "#FFFFFF", border: "none" };
  }
  if (variant === "secondary") {
    return { ...base, background: "transparent", color: T.color.navy,
      border: `1px solid ${T.color.navy}` };
  }
  if (variant === "quiet") {
    return { ...base, background: "transparent", color: T.color.textMuted,
      border: `1px solid ${T.color.borderStrong}` };
  }
  if (variant === "danger") {
    return { ...base, background: "transparent", color: T.color.danger,
      border: `1px solid ${T.color.danger}` };
  }
  return base;
}

export function input(opts = {}) {
  return {
    width: "100%",
    minHeight: T.touch,
    background: T.color.surface,
    border: `1px solid ${opts.invalid ? T.color.danger : T.color.borderStrong}`,
    borderRadius: T.radius.md,
    padding: "12px 16px",
    fontFamily: T.font.text,
    fontSize: 16,
    color: T.color.text,
    outline: "none",
    boxSizing: "border-box",
  };
}

export function card(opts = {}) {
  return {
    background: T.color.surface,
    border: `1px solid ${T.color.border}`,
    borderRadius: T.radius.md,
    boxShadow: opts.raised ? T.elevation.sm : T.elevation.none,
    boxSizing: "border-box",
  };
}
