import type { LandingTheme } from "@/lib/landing/schema";
import type { FallbackVisualId } from "@/lib/landing/templates";

// Abstract, on-brand compositions used whenever a section has no real image
// — never a "pending"/broken-looking placeholder. Built from theme colors
// only (gradients, grids, mockup chrome, device frames), so it always reads
// as an intentional design choice regardless of preset. Pure SVG/JSX (no
// dangerouslySetInnerHTML) so arbitrary user-edited theme color strings can
// never inject markup — same safety posture as the rest of the renderer.
export function FallbackVisual({ variant, theme, tall }: { variant: FallbackVisualId; theme: LandingTheme; tall?: boolean }) {
  const h = tall ? 320 : 120;
  const r = theme.radius === "none" ? 0 : theme.radius === "md" ? 12 : theme.radius === "lg" ? 20 : 28;

  return (
    <svg
      viewBox={`0 0 480 ${h}`}
      className="w-full"
      style={{ height: tall ? undefined : h, borderRadius: r, display: "block", background: theme.surface }}
      role="img"
      aria-label="Composición visual decorativa"
    >
      <defs>
        <linearGradient id="lp-fb-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.primary} />
          <stop offset="100%" stopColor={theme.secondary} />
        </linearGradient>
      </defs>
      {renderVariant(variant, theme, h)}
    </svg>
  );
}

function renderVariant(variant: FallbackVisualId, theme: LandingTheme, h: number) {
  switch (variant) {
    case "dashboard-mockup":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          <rect x="20" y="20" width="440" height={h - 40} rx="10" fill={theme.surface} stroke={theme.muted} strokeOpacity="0.2" />
          <rect x="20" y="20" width="440" height="28" rx="10" fill="url(#lp-fb-grad)" />
          <circle cx="36" cy="34" r="4" fill="#fff" opacity="0.8" />
          <circle cx="50" cy="34" r="4" fill="#fff" opacity="0.5" />
          <rect x="36" y="64" width="120" height={h - 100} rx="8" fill={theme.background} />
          <rect x="168" y="64" width="276" height="34" rx="8" fill={theme.background} />
          <rect x="168" y="106" width="276" height="34" rx="8" fill={theme.background} />
          <rect x="168" y="148" width="140" height={h - 184} rx="8" fill="url(#lp-fb-grad)" opacity="0.85" />
        </>
      );
    case "abstract-arch":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          <circle cx="380" cy={h * 0.4} r={h * 0.55} fill="url(#lp-fb-grad)" opacity="0.9" />
          <circle cx="120" cy={h * 0.75} r={h * 0.3} fill={theme.secondary} opacity="0.35" />
          <rect x="0" y={h - 14} width="480" height="14" fill={theme.primary} opacity="0.15" />
        </>
      );
    case "grid-pattern":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          {Array.from({ length: 6 }).map((_, col) =>
            Array.from({ length: 3 }).map((_, row) => (
              <rect
                key={`${col}-${row}`}
                x={20 + col * 74}
                y={20 + row * (h - 40 > 0 ? (h - 40) / 3 : 0)}
                width="58"
                height={Math.max((h - 40) / 3 - 12, 8)}
                rx="6"
                fill={(col + row) % 3 === 0 ? "url(#lp-fb-grad)" : theme.surface}
                opacity={(col + row) % 3 === 0 ? 0.9 : 1}
                stroke={theme.muted}
                strokeOpacity="0.15"
              />
            )),
          )}
        </>
      );
    case "editorial-shape":
      return (
        <>
          <rect width="480" height={h} fill={theme.surface} />
          <line x1="40" y1={h * 0.2} x2="40" y2={h * 0.8} stroke={theme.primary} strokeWidth="2" />
          <circle cx="300" cy={h * 0.5} r={h * 0.32} fill="none" stroke="url(#lp-fb-grad)" strokeWidth="2" />
          <circle cx="300" cy={h * 0.5} r={h * 0.18} fill={theme.primary} opacity="0.15" />
        </>
      );
    case "device-frame":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          <rect x="150" y="10" width="180" height={h - 20} rx="18" fill={theme.surface} stroke={theme.muted} strokeOpacity="0.25" />
          <rect x="164" y="26" width="152" height={h - 70} rx="8" fill="url(#lp-fb-grad)" opacity="0.85" />
          <circle cx="240" cy={h - 26} r="6" fill={theme.muted} opacity="0.4" />
        </>
      );
    case "circuit-lines":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          <path
            d={`M20 ${h * 0.5} H160 V${h * 0.2} H300 V${h * 0.7} H460`}
            fill="none"
            stroke="url(#lp-fb-grad)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="160" cy={h * 0.2} r="6" fill={theme.secondary} />
          <circle cx="300" cy={h * 0.7} r="6" fill={theme.primary} />
          <circle cx="20" cy={h * 0.5} r="5" fill={theme.primary} />
          <circle cx="460" cy={h * 0.7} r="5" fill={theme.secondary} />
        </>
      );
    case "warm-texture":
      return (
        <>
          <rect width="480" height={h} fill={theme.background} />
          <circle cx="90" cy={h * 0.3} r={h * 0.28} fill={theme.primary} opacity="0.25" />
          <circle cx="230" cy={h * 0.65} r={h * 0.22} fill={theme.secondary} opacity="0.3" />
          <circle cx="380" cy={h * 0.35} r={h * 0.35} fill="url(#lp-fb-grad)" opacity="0.5" />
        </>
      );
    default:
      return <rect width="480" height={h} fill={theme.surface} />;
  }
}

// Abstract "logo chip" row used when trust_logos has no real logos yet —
// varied-width rounded bars reading as an intentional placeholder-brand
// row, never as broken/missing content.
export function FallbackLogoRow({ theme }: { theme: LandingTheme }) {
  const widths = [64, 88, 52, 96, 60];
  return (
    <div className="flex flex-wrap items-center justify-center gap-8 opacity-60" aria-hidden="true">
      {widths.map((w, i) => (
        <span key={i} className="h-5 rounded-full" style={{ width: w, background: theme.muted }} />
      ))}
    </div>
  );
}
