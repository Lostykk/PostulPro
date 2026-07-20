import { useId } from "react";

// Single source of truth for PostulPro's icon mark — a "P" that resolves
// into a checkmark, in the brand's cyan-to-magenta gradient. Inlined as
// JSX (not an <img>) so it's crisp at any size and never issues an extra
// request. The same shape backs public/logo-mark.svg (used standalone by
// e.g. og:image tooling) and the generated favicon/app-icon assets — keep
// all three in sync if this path ever changes.
//
// The gradient id is per-instance (via useId) because this component can
// legitimately render more than once on the same page (the landing page
// uses it in both its header and its footer) — a shared literal id would
// collide across multiple SVGs in the same DOM.
export function PostulProMark({ className = "h-8 w-8" }: { className?: string }) {
  const gradientId = `postulpro-mark-gradient-${useId()}`;
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="PostulPro">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="0.4" stopColor="#3b82f6" />
          <stop offset="0.65" stopColor="#c026d3" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <path
        d="M11 7 C11 6.44772 11.4477 6 12 6 L15.5 6 C19.0899 6 22 8.91015 22 12.5 C22 16.0899 19.0899 19 15.5 19 L13 19 L13 25 C13 25.5523 12.5523 26 12 26 L10 26 C9.44772 26 9 25.5523 9 25 L9 8 C9 7.44772 9.44772 7 10 7 Z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={2.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M12.5 13.5 L14.7 16 L20 10"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
