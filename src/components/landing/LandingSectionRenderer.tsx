import type { LandingSection, LandingTheme } from "@/lib/landing/schema";
import { buttonClassName } from "@/lib/landing/themes";

// Pure, read-only visual rendering of one section — shared by the builder's
// live preview, the self-contained HTML export, and the public /p/:slug
// page, so all three are guaranteed to look the same. Never renders raw
// JSON/markdown; every field is read straight off `section.content`.
export function LandingSectionRenderer({ section, theme }: { section: LandingSection; theme: LandingTheme }) {
  if (!section.visible) return null;
  const c = section.content;
  const btn = buttonClassName(theme);
  const btnStyle = buttonStyle(theme);
  const wrap = "w-full px-4 md:px-8";
  const inner = "mx-auto";
  const innerStyle = { maxWidth: "var(--lp-max-width)" };
  const sectionPad = { padding: "var(--lp-spacing) 0" };

  switch (section.type) {
    case "announcement_bar":
      return (
        <div className="w-full text-center text-sm py-2.5 px-4" style={{ background: "var(--lp-primary)", color: "#fff" }}>
          {c.body}
          {c.ctaLabel && (
            <a href={c.ctaHref || "#"} className="ml-2 underline font-medium">
              {c.ctaLabel}
            </a>
          )}
        </div>
      );

    case "navigation":
      return (
        <div className={wrap} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
          <div className={`${inner} flex items-center justify-between py-4`} style={innerStyle}>
            <span className="font-bold text-lg" style={{ fontFamily: "var(--lp-font)" }}>
              {c.title}
            </span>
            <nav className="hidden sm:flex items-center gap-6 text-sm">
              {(c.navLinks ?? []).map((l, i) => (
                <a key={i} href={l.href} style={{ color: "var(--lp-muted)" }}>
                  {l.label}
                </a>
              ))}
            </nav>
            {c.ctaLabel && (
              <a href={c.ctaHref || "#"} className={btn} style={btnStyle}>
                {c.ctaLabel}
              </a>
            )}
          </div>
        </div>
      );

    case "hero":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} grid md:grid-cols-2 gap-8 items-center`} style={innerStyle}>
            <div className="text-center md:text-left">
              {c.eyebrow && (
                <span className="inline-block text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--lp-primary)" }}>
                  {c.eyebrow}
                </span>
              )}
              <h1 className="text-3xl md:text-5xl font-bold leading-tight" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h1>
              {c.subtitle && (
                <p className="mt-4 text-lg" style={{ color: "var(--lp-muted)" }}>
                  {c.subtitle}
                </p>
              )}
              {c.body && (
                <p className="mt-3 text-sm" style={{ color: "var(--lp-muted)" }}>
                  {c.body}
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-3 justify-center md:justify-start">
                {c.ctaLabel && (
                  <a href={c.ctaHref || "#"} className={btn} style={btnStyle}>
                    {c.ctaLabel}
                  </a>
                )}
                {c.secondaryCtaLabel && (
                  <a href={c.secondaryCtaHref || "#"} className="inline-flex items-center px-6 py-3 text-sm font-semibold" style={{ color: "var(--lp-text)" }}>
                    {c.secondaryCtaLabel}
                  </a>
                )}
              </div>
            </div>
            <HeroImage image={c.image} />
          </div>
        </div>
      );

    case "trust_logos":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <p className="text-center text-xs uppercase tracking-wide mb-6" style={{ color: "var(--lp-muted)" }}>
                {c.title}
              </p>
            )}
            {(c.logos ?? []).length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-8 opacity-70">
                {c.logos!.map((l, i) => (
                  <span key={i} className="text-sm font-medium">
                    {l}
                  </span>
                ))}
              </div>
            ) : (
              <PendingPlaceholder label="Logos pendientes" />
            )}
          </div>
        </div>
      );

    case "problem":
    case "solution":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} max-w-2xl text-center`} style={innerStyle}>
            <h2 className="text-2xl md:text-3xl font-bold" style={{ fontFamily: "var(--lp-font)" }}>
              {c.title}
            </h2>
            {c.body && (
              <p className="mt-4 text-base" style={{ color: "var(--lp-muted)" }}>
                {c.body}
              </p>
            )}
          </div>
        </div>
      );

    case "benefits":
    case "features":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(c.items ?? []).map((it, i) => (
                <div
                  key={i}
                  className="p-5"
                  style={{ background: "var(--lp-surface)", borderRadius: "var(--lp-radius)", boxShadow: "var(--lp-shadow)" }}
                >
                  <h3 className="font-semibold">{it.title}</h3>
                  {it.body && (
                    <p className="mt-1.5 text-sm" style={{ color: "var(--lp-muted)" }}>
                      {it.body}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "how_it_works":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="grid sm:grid-cols-3 gap-6">
              {(c.items ?? []).map((it, i) => (
                <div key={i} className="text-center">
                  <div
                    className="w-9 h-9 mx-auto mb-3 grid place-items-center font-bold text-sm"
                    style={{ background: "var(--lp-primary)", color: "#fff", borderRadius: "var(--lp-radius)" }}
                  >
                    {i + 1}
                  </div>
                  <h3 className="font-semibold">{it.title}</h3>
                  {it.body && (
                    <p className="mt-1.5 text-sm" style={{ color: "var(--lp-muted)" }}>
                      {it.body}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "statistics":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} grid grid-cols-2 sm:grid-cols-4 gap-6 text-center`} style={innerStyle}>
            {(c.stats ?? []).map((s, i) => (
              <div key={i}>
                <div className="text-3xl font-bold" style={{ color: "var(--lp-primary)", fontFamily: "var(--lp-font)" }}>
                  {s.value}
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--lp-muted)" }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "testimonials":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(c.testimonials ?? []).map((t, i) => (
                <div key={i} className="p-5" style={{ background: "var(--lp-surface)", borderRadius: "var(--lp-radius)" }}>
                  <p className="text-sm italic">&ldquo;{t.quote}&rdquo;</p>
                  <p className="mt-3 text-xs font-semibold">
                    {t.name}
                    {t.role && <span className="font-normal" style={{ color: "var(--lp-muted)" }}> · {t.role}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "comparison":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="grid sm:grid-cols-2 gap-5">
              {(c.items ?? []).map((it, i) => (
                <div
                  key={i}
                  className="p-5"
                  style={{
                    background: i === 0 ? "var(--lp-surface)" : "transparent",
                    border: i === 0 ? `2px solid var(--lp-primary)` : "1px solid rgba(128,128,128,0.2)",
                    borderRadius: "var(--lp-radius)",
                  }}
                >
                  <h3 className="font-semibold">{it.title}</h3>
                  <p className="mt-1.5 text-sm" style={{ color: "var(--lp-muted)" }}>
                    {it.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "pricing":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={inner} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(c.pricing ?? []).map((tier, i) => (
                <div
                  key={i}
                  className="p-6 flex flex-col"
                  style={{
                    background: "var(--lp-surface)",
                    borderRadius: "var(--lp-radius)",
                    border: tier.highlighted ? `2px solid var(--lp-primary)` : "1px solid rgba(128,128,128,0.15)",
                    boxShadow: tier.highlighted ? "var(--lp-shadow)" : "none",
                  }}
                >
                  <h3 className="font-semibold">{tier.name}</h3>
                  <div className="mt-2 text-2xl font-bold" style={{ fontFamily: "var(--lp-font)" }}>
                    {tier.price}
                    {tier.period && <span className="text-sm font-normal" style={{ color: "var(--lp-muted)" }}>{tier.period}</span>}
                  </div>
                  <ul className="mt-4 space-y-1.5 text-sm flex-1">
                    {tier.features.map((f, j) => (
                      <li key={j} style={{ color: "var(--lp-muted)" }}>
                        ✓ {f}
                      </li>
                    ))}
                  </ul>
                  <a href="#" className={`${btn} mt-5 justify-center`} style={btnStyle}>
                    {tier.ctaLabel}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "offer":
      return (
        <div className={wrap} style={sectionPad}>
          <div
            className={`${inner} text-center p-8`}
            style={{ ...innerStyle, background: "var(--lp-surface)", borderRadius: "var(--lp-radius)" }}
          >
            <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--lp-font)" }}>
              {c.title}
            </h2>
            {c.body && (
              <p className="mt-3 text-sm" style={{ color: "var(--lp-muted)" }}>
                {c.body}
              </p>
            )}
            {c.ctaLabel && (
              <a href={c.ctaHref || "#"} className={`${btn} mt-5`} style={btnStyle}>
                {c.ctaLabel}
              </a>
            )}
          </div>
        </div>
      );

    case "guarantee":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} max-w-xl text-center`} style={innerStyle}>
            <h2 className="text-xl font-bold" style={{ fontFamily: "var(--lp-font)" }}>
              {c.title}
            </h2>
            {c.body && (
              <p className="mt-3 text-sm" style={{ color: "var(--lp-muted)" }}>
                {c.body}
              </p>
            )}
          </div>
        </div>
      );

    case "faq":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} max-w-2xl`} style={innerStyle}>
            {c.title && (
              <h2 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className="space-y-4">
              {(c.faq ?? []).map((f, i) => (
                <div key={i} className="pb-4" style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                  <p className="font-semibold text-sm">{f.q}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--lp-muted)" }}>
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "lead_form":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} max-w-md`} style={innerStyle}>
            {c.title && (
              <h2 className="text-xl font-bold text-center mb-5" style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <form
              className="space-y-3"
              style={{ background: "var(--lp-surface)", borderRadius: "var(--lp-radius)" }}
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="p-5 space-y-3">
                {(c.formFields ?? []).map((f, i) => (
                  <label key={i} className="block text-xs" style={{ color: "var(--lp-muted)" }}>
                    <span className="sr-only">{f}</span>
                    <input
                      type="text"
                      placeholder={f}
                      disabled
                      className="w-full h-10 px-3 text-sm bg-transparent"
                      style={{ border: "1px solid rgba(128,128,128,0.25)", borderRadius: "var(--lp-radius)", color: "var(--lp-text)" }}
                    />
                  </label>
                ))}
                <button
                  type="submit"
                  disabled
                  title="La captura de leads todavía no está disponible en esta preview"
                  className={`${btn} w-full justify-center`}
                  style={btnStyle}
                >
                  {c.ctaLabel || "Enviar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      );

    case "final_cta":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} text-center`} style={innerStyle}>
            <h2 className="text-2xl md:text-3xl font-bold" style={{ fontFamily: "var(--lp-font)" }}>
              {c.title}
            </h2>
            {c.ctaLabel && (
              <a href={c.ctaHref || "#"} className={`${btn} mt-5`} style={btnStyle}>
                {c.ctaLabel}
              </a>
            )}
          </div>
        </div>
      );

    case "footer":
      return (
        <div className={wrap} style={{ padding: "2rem 0", borderTop: "1px solid rgba(128,128,128,0.15)" }}>
          <div className={`${inner} text-center text-xs`} style={{ ...innerStyle, color: "var(--lp-muted)" }}>
            <p className="font-semibold text-sm mb-1" style={{ color: "var(--lp-text)" }}>
              {c.title}
            </p>
            {c.body}
          </div>
        </div>
      );

    default:
      return null;
  }
}

function buttonStyle(theme: LandingTheme): React.CSSProperties {
  if (theme.buttonStyle === "gradient") {
    return { background: `linear-gradient(to right, var(--lp-primary), var(--lp-secondary))`, color: "#fff" };
  }
  if (theme.buttonStyle === "outline") {
    return { borderColor: "var(--lp-primary)", color: "var(--lp-primary)" };
  }
  return { background: "var(--lp-primary)", color: "#fff" };
}

function HeroImage({ image }: { image?: { url: string | null; alt: string } }) {
  if (image?.url) {
    return <img src={image.url} alt={image.alt} className="w-full" style={{ borderRadius: "var(--lp-radius)" }} />;
  }
  return <PendingPlaceholder label="Imagen de portada pendiente" tall />;
}

function PendingPlaceholder({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div
      className={`w-full ${tall ? "h-56" : "h-20"} grid place-items-center text-xs border-2 border-dashed`}
      style={{ borderRadius: "var(--lp-radius)", borderColor: "rgba(128,128,128,0.3)", color: "var(--lp-muted)" }}
    >
      {label}
    </div>
  );
}
