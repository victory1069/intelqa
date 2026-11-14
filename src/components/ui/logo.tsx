/** The mark and wordmark (brand guide §03–§05). Geometry matches IntelQAMark/IntelQALogo. */

const RING = "M47 9a38 38 0 1 0 0.01 0zM47 26a21 21 0 1 1 -0.01 0z";

type Variant = "theme" | "color" | "violet" | "dark" | "white";

const COLORS: Record<Variant, { ink: string; ring: string; dot: string }> = {
  theme: { ink: "var(--logo-ink)", ring: "var(--logo-ring)", dot: "var(--logo-dot)" },
  color: { ink: "#15132B", ring: "#5B3DF5", dot: "#5B3DF5" },
  violet: { ink: "#FFFFFF", ring: "#FFFFFF", dot: "#FFD43B" },
  dark: { ink: "#FFFFFF", ring: "#FFFFFF", dot: "#FFD43B" },
  white: { ink: "#FFFFFF", ring: "#FFFFFF", dot: "#FFFFFF" },
};

function MarkPaths({ ring, dot }: { ring: string; dot: string }) {
  return (
    <>
      <path d={RING} style={{ fill: ring }} fillRule="evenodd" />
      <rect x="61.3" y="66.3" width="28" height="18" rx="3" transform="rotate(45 75.3 75.3)" style={{ fill: ring }} />
      <circle cx="47" cy="47" r="10" style={{ fill: dot }} />
    </>
  );
}

export function Mark({ size = 48, variant = "theme" }: { size?: number; variant?: Variant }) {
  const c = COLORS[variant];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <MarkPaths ring={c.ring} dot={c.dot} />
    </svg>
  );
}

/** Wordmark with the symbol set in as the Q, plus the CBT tag (dropped below 112px wide). */
export function Logo({ size = 24, variant = "theme", tag = true }: { size?: number; variant?: Variant; tag?: boolean }) {
  const c = COLORS[variant];
  return (
    <span role="img" aria-label="IntelQA CBT" style={{ display: "inline-flex", alignItems: "center", gap: "0.2em", fontSize: size, lineHeight: 1, whiteSpace: "nowrap" }}>
      <span
        style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.045em", color: c.ink, display: "inline-flex", alignItems: "baseline" }}
      >
        Intel
        <svg viewBox="0 0 100 100" style={{ width: "0.87em", height: "0.87em", margin: "0 -0.075em 0 0.01em", position: "relative", top: "0.118em", overflow: "visible", flex: "none" }}>
          <MarkPaths ring={c.ring} dot={c.dot} />
        </svg>
        A
      </span>
      {tag && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: "0.34em",
            letterSpacing: "0.06em",
            padding: "0.2em 0.34em 0.16em",
            borderRadius: "0.16em",
            border: `0.11em solid ${variant === "white" ? "#FFFFFF" : "#FFD43B"}`,
            background: variant === "white" ? "transparent" : "#FFD43B",
            color: variant === "white" ? "#FFFFFF" : "#15132B",
            alignSelf: "center",
            marginTop: "0.1em",
          }}
        >
          CBT
        </span>
      )}
    </span>
  );
}
