import type { LandingSection, LandingTemplateId, LandingTheme } from "@/lib/landing/schema";
import { buttonClassName } from "@/lib/landing/themes";
import { templateConfig, type LandingTemplateConfig, type FallbackVisualId } from "@/lib/landing/templates";
import { FallbackVisual, FallbackLogoRow } from "@/components/landing/FallbackVisual";

const GRID_COLS_CLASS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function cardStyleProps(style: LandingTemplateConfig["cardStyle"], theme: LandingTheme): React.CSSProperties {
  switch (style) {
    case "flat":
      return { background: "transparent", borderRadius: "var(--lp-radius)" };
    case "bordered":
      return { background: theme.surface, borderRadius: "var(--lp-radius)", border: `1px solid ${theme.muted}33` };
    case "gradient-top":
      return {
        background: theme.surface,
        borderRadius: "var(--lp-radius)",
        borderTop: `3px solid ${theme.primary}`,
        boxShadow: theme.shadow ? "var(--lp-shadow)" : "none",
      };
    case "shadow-lift":
    default:
      return { background: theme.surface, borderRadius: "var(--lp-radius)", boxShadow: "var(--lp-shadow)" };
  }
}

function headingClass(transform: LandingTemplateConfig["headingTransform"]): string {
  return transform === "uppercase" ? "uppercase tracking-wide" : "";
}

function ProvenanceBadge({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mb-1.5"
      style={{ background: "rgba(234,179,8,0.15)", color: "#eab308" }}
    >
      Ejemplo — revisar
    </span>
  );
}

// Pure, read-only visual rendering of one section — shared by the builder's
// live preview, the self-contained HTML export, and the public /p/:slug
// page, so all three are guaranteed to look the same. Never renders raw
// JSON/markdown; every field is read straight off `section.content`. The
// `templateId` drives structural layout choices (hero composition, nav
// chrome, grid density, card treatment, heading case) — the same section
// data renders differently per template without ever changing `content`.
export function LandingSectionRenderer({
  section,
  theme,
  templateId = "saas_premium",
}: {
  section: LandingSection;
  theme: LandingTheme;
  templateId?: LandingTemplateId;
}) {
  if (!section.visible) return null;
  const c = section.content;
  const tpl = templateConfig(templateId);
  const btn = buttonClassName(theme);
  const btnStyle = buttonStyle(theme);
  const wrap = "w-full px-4 md:px-8";
  const inner = "mx-auto";
  const innerStyle = { maxWidth: "var(--lp-max-width)" };
  const sectionPad = { padding: "var(--lp-spacing) 0" };
  const hClass = headingClass(tpl.headingTransform);
  const gridColsClass = GRID_COLS_CLASS[tpl.gridColumns] ?? GRID_COLS_CLASS[3];
  const cardStyle = cardStyleProps(tpl.cardStyle, theme);

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

    case "navigation": {
      const brand = (
        <span className={`font-bold text-lg ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
          {c.title}
        </span>
      );
      const links = (c.navLinks ?? []).map((l, i) => (
        <a
          key={i}
          href={l.href}
          style={{ color: "var(--lp-muted)" }}
          className={tpl.navStyle === "bold-underline" ? "hover:border-b-2 pb-0.5" : undefined}
        >
          {l.label}
        </a>
      ));
      const cta = c.ctaLabel && (
        <a href={c.ctaHref || "#"} className={btn} style={btnStyle}>
          {c.ctaLabel}
        </a>
      );
      if (tpl.navStyle === "minimal-centered") {
        return (
          <div className={wrap} style={{ borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
            <div className={`${inner} flex flex-col items-center gap-2 py-5 text-center`} style={innerStyle}>
              {brand}
              <nav className="hidden sm:flex items-center gap-6 text-sm">{links}</nav>
            </div>
          </div>
        );
      }
      if (tpl.navStyle === "boxed") {
        return (
          <div className={wrap} style={{ padding: "16px 0" }}>
            <div
              className={`${inner} flex items-center justify-between px-5 py-3`}
              style={{ ...innerStyle, background: "var(--lp-surface)", borderRadius: "var(--lp-radius)", boxShadow: "var(--lp-shadow)" }}
            >
              {brand}
              <nav className="hidden sm:flex items-center gap-6 text-sm">{links}</nav>
              {cta}
            </div>
          </div>
        );
      }
      return (
        <div className={wrap} style={{ borderBottom: tpl.navStyle === "bold-underline" ? `2px solid var(--lp-primary)` : "1px solid rgba(128,128,128,0.15)" }}>
          <div className={`${inner} flex items-center justify-between py-4`} style={innerStyle}>
            {brand}
            <nav className="hidden sm:flex items-center gap-6 text-sm">{links}</nav>
            {cta}
          </div>
        </div>
      );
    }

    case "hero": {
      const textBlock = (
        <>
          {c.eyebrow && (
            <span className="inline-block text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--lp-primary)" }}>
              {c.eyebrow}
            </span>
          )}
          <h1 className={`text-3xl md:text-5xl font-bold leading-tight ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
        </>
      );
      const ctas = (justify: string) => (
        <div className={`mt-6 flex flex-wrap gap-3 ${justify}`}>
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
      );
      const heroImg = <HeroImage image={c.image} fallback={tpl.fallbackVisualId} theme={theme} />;

      if (tpl.heroLayout === "centered") {
        return (
          <div className={wrap} style={sectionPad}>
            <div className={`${inner} text-center max-w-2xl`} style={innerStyle}>
              {textBlock}
              {ctas("justify-center")}
            </div>
          </div>
        );
      }
      if (tpl.heroLayout === "fullbleed") {
        return (
          <div className={wrap} style={sectionPad}>
            <div className={inner} style={innerStyle}>
              <div className="mb-8">{heroImg}</div>
              <div className="text-center max-w-2xl mx-auto">
                {textBlock}
                {ctas("justify-center")}
              </div>
            </div>
          </div>
        );
      }
      if (tpl.heroLayout === "editorial") {
        return (
          <div className={wrap} style={sectionPad}>
            <div className={`${inner} grid md:grid-cols-[1.3fr_1fr] gap-10 items-center`} style={innerStyle}>
              <div className="text-center md:text-left border-l-0 md:border-l-2 md:pl-8" style={{ borderColor: "var(--lp-primary)" }}>
                {textBlock}
                {ctas("justify-center md:justify-start")}
              </div>
              {heroImg}
            </div>
          </div>
        );
      }
      const imageFirst = tpl.heroLayout === "split-left";
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} grid md:grid-cols-2 gap-8 items-center`} style={innerStyle}>
            <div className={`text-center md:text-left ${imageFirst ? "md:order-2" : ""}`}>
              {textBlock}
              {ctas("justify-center md:justify-start")}
            </div>
            <div className={imageFirst ? "md:order-1" : ""}>{heroImg}</div>
          </div>
        </div>
      );
    }

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
              <FallbackLogoRow theme={theme} />
            )}
          </div>
        </div>
      );

    case "problem":
    case "solution":
      return (
        <div className={wrap} style={sectionPad}>
          <div className={`${inner} max-w-2xl text-center`} style={innerStyle}>
            <h2 className={`text-2xl md:text-3xl font-bold ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className={`grid ${gridColsClass} gap-5`}>
              {(c.items ?? []).map((it, i) => (
                <div key={i} className="p-5" style={cardStyle}>
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
                <ProvenanceBadge show={s.source === "ai_suggested"} />
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className={`grid ${gridColsClass} gap-5`}>
              {(c.testimonials ?? []).map((t, i) => (
                <div key={i} className="p-5" style={cardStyle}>
                  <ProvenanceBadge show={t.source === "ai_suggested"} />
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
                {c.title}
              </h2>
            )}
            <div className={`grid ${gridColsClass} gap-5`}>
              {(c.pricing ?? []).map((tier, i) => (
                <div
                  key={i}
                  className="p-6 flex flex-col"
                  style={{
                    ...cardStyle,
                    border: tier.highlighted ? `2px solid var(--lp-primary)` : (cardStyle.border as string) ?? "1px solid rgba(128,128,128,0.15)",
                    boxShadow: tier.highlighted ? "var(--lp-shadow)" : cardStyle.boxShadow ?? "none",
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
            <h2 className={`text-2xl font-bold ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
            <h2 className={`text-xl font-bold ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
              <h2 className={`text-2xl md:text-3xl font-bold text-center mb-10 ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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
            <h2 className={`text-2xl md:text-3xl font-bold ${hClass}`} style={{ fontFamily: "var(--lp-font)" }}>
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

    case "footer": {
      if (tpl.footerStyle === "cta-band") {
        return (
          <div className={wrap} style={{ padding: "3rem 0 2rem" }}>
            <div
              className={`${inner} text-center p-8 mb-8`}
              style={{ ...innerStyle, background: "var(--lp-surface)", borderRadius: "var(--lp-radius)" }}
            >
              <p className={`font-bold text-lg ${hClass}`} style={{ color: "var(--lp-text)" }}>
                {c.title}
              </p>
            </div>
            <div className={`${inner} text-center text-xs`} style={{ ...innerStyle, color: "var(--lp-muted)" }}>
              {c.body}
            </div>
          </div>
        );
      }
      if (tpl.footerStyle === "columns") {
        return (
          <div className={wrap} style={{ padding: "2.5rem 0", borderTop: "1px solid rgba(128,128,128,0.15)" }}>
            <div className={`${inner} grid sm:grid-cols-2 gap-4 text-xs`} style={{ ...innerStyle, color: "var(--lp-muted)" }}>
              <p className="font-semibold text-sm" style={{ color: "var(--lp-text)" }}>
                {c.title}
              </p>
              <p className="sm:text-right">{c.body}</p>
            </div>
          </div>
        );
      }
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
    }

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

function HeroImage({
  image,
  fallback,
  theme,
}: {
  image?: { url: string | null; alt: string };
  fallback: FallbackVisualId;
  theme: LandingTheme;
}) {
  if (image?.url) {
    return <img src={image.url} alt={image.alt} className="w-full" style={{ borderRadius: "var(--lp-radius)" }} />;
  }
  return <FallbackVisual variant={fallback} theme={theme} tall />;
}
