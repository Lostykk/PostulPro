import type { LandingPageV3, LandingSection, LandingTheme } from "@/lib/landing/schema";
import { themeCssVarsInline } from "@/lib/landing/themes";
import { templateConfig, type FallbackVisualId, type LandingTemplateConfig } from "@/lib/landing/templates";

// The in-app preview (LandingSectionRenderer) relies on Tailwind utility
// classes for layout/typography — fine in-app, where the compiled
// stylesheet is always present, but useless in a downloaded file with no
// build step. This generates fully self-contained HTML instead: every
// section is hand-rendered with inline-friendly semantic classes backed by
// one small embedded <style> block (plus the theme's CSS vars), so the
// export opens correctly offline with zero external requests.

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Only allow http(s)/mailto/relative/hash links — never javascript: or other
// script-executing schemes, matching the sanitization rule used elsewhere
// (see RichContentRenderer's isSafeHref).
function safeHref(href: string | undefined): string {
  if (!href) return "#";
  const trimmed = href.trim();
  if (/^(https?:|mailto:|#|\/)/i.test(trimmed)) return esc(trimmed);
  return "#";
}

function safeImgSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url.trim())) return esc(url.trim());
  return null;
}

// String-rendered mirror of FallbackVisual.tsx / FallbackLogoRow — same
// abstract, on-brand compositions (never "pending"/broken placeholders),
// built only from theme colors (escaped, since theme colors are
// user-editable free text) so the offline HTML export never depends on a
// missing image or external asset to look complete.
function fallbackVisualSvg(variant: FallbackVisualId, theme: LandingTheme, tall: boolean): string {
  const h = tall ? 320 : 120;
  const p = esc(theme.primary);
  const s = esc(theme.secondary);
  const bg = esc(theme.background);
  const surface = esc(theme.surface);
  const grad = `<linearGradient id="lp-fb-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${p}"/><stop offset="100%" stop-color="${s}"/></linearGradient>`;
  let body = "";
  switch (variant) {
    case "dashboard-mockup":
      body = `<rect width="480" height="${h}" fill="${bg}"/><rect x="20" y="20" width="440" height="${h - 40}" rx="10" fill="${surface}"/><rect x="20" y="20" width="440" height="28" rx="10" fill="url(#lp-fb-grad)"/><rect x="36" y="64" width="120" height="${h - 100}" rx="8" fill="${bg}"/><rect x="168" y="64" width="276" height="34" rx="8" fill="${bg}"/><rect x="168" y="106" width="276" height="34" rx="8" fill="${bg}"/><rect x="168" y="148" width="140" height="${Math.max(h - 184, 8)}" rx="8" fill="url(#lp-fb-grad)" opacity="0.85"/>`;
      break;
    case "abstract-arch":
      body = `<rect width="480" height="${h}" fill="${bg}"/><circle cx="380" cy="${h * 0.4}" r="${h * 0.55}" fill="url(#lp-fb-grad)" opacity="0.9"/><circle cx="120" cy="${h * 0.75}" r="${h * 0.3}" fill="${s}" opacity="0.35"/>`;
      break;
    case "grid-pattern":
      body = `<rect width="480" height="${h}" fill="${bg}"/>` +
        Array.from({ length: 6 })
          .flatMap((_, col) =>
            Array.from({ length: 3 }).map((_row, row) => {
              const w = 58;
              const rh = Math.max((h - 40) / 3 - 12, 8);
              const x = 20 + col * 74;
              const y = 20 + row * ((h - 40) / 3);
              const fill = (col + row) % 3 === 0 ? "url(#lp-fb-grad)" : surface;
              return `<rect x="${x}" y="${y}" width="${w}" height="${rh}" rx="6" fill="${fill}"/>`;
            }),
          )
          .join("");
      break;
    case "editorial-shape":
      body = `<rect width="480" height="${h}" fill="${surface}"/><line x1="40" y1="${h * 0.2}" x2="40" y2="${h * 0.8}" stroke="${p}" stroke-width="2"/><circle cx="300" cy="${h * 0.5}" r="${h * 0.32}" fill="none" stroke="url(#lp-fb-grad)" stroke-width="2"/>`;
      break;
    case "device-frame":
      body = `<rect width="480" height="${h}" fill="${bg}"/><rect x="150" y="10" width="180" height="${h - 20}" rx="18" fill="${surface}"/><rect x="164" y="26" width="152" height="${h - 70}" rx="8" fill="url(#lp-fb-grad)" opacity="0.85"/>`;
      break;
    case "circuit-lines":
      body = `<rect width="480" height="${h}" fill="${bg}"/><path d="M20 ${h * 0.5} H160 V${h * 0.2} H300 V${h * 0.7} H460" fill="none" stroke="url(#lp-fb-grad)" stroke-width="3"/><circle cx="160" cy="${h * 0.2}" r="6" fill="${s}"/><circle cx="300" cy="${h * 0.7}" r="6" fill="${p}"/>`;
      break;
    case "warm-texture":
      body = `<rect width="480" height="${h}" fill="${bg}"/><circle cx="90" cy="${h * 0.3}" r="${h * 0.28}" fill="${p}" opacity="0.25"/><circle cx="230" cy="${h * 0.65}" r="${h * 0.22}" fill="${s}" opacity="0.3"/><circle cx="380" cy="${h * 0.35}" r="${h * 0.35}" fill="url(#lp-fb-grad)" opacity="0.5"/>`;
      break;
    default:
      body = `<rect width="480" height="${h}" fill="${surface}"/>`;
  }
  return `<svg viewBox="0 0 480 ${h}" style="width:100%;height:${tall ? "auto" : `${h}px`};display:block;border-radius:var(--lp-radius);background:${surface};" role="img" aria-label="Composición visual decorativa"><defs>${grad}</defs>${body}</svg>`;
}

function fallbackLogoRowHtml(theme: LandingTheme): string {
  const widths = [64, 88, 52, 96, 60];
  const muted = esc(theme.muted);
  return `<div style="display:flex;flex-wrap:wrap;gap:28px;justify-content:center;opacity:0.6;" aria-hidden="true">${widths
    .map((w) => `<span style="width:${w}px;height:20px;border-radius:999px;background:${muted};display:inline-block;"></span>`)
    .join("")}</div>`;
}

function gridColsCss(n: LandingTemplateConfig["gridColumns"]): string {
  return `grid-template-columns:repeat(${n},1fr);`;
}

function cardStyleCss(style: LandingTemplateConfig["cardStyle"], theme: LandingTheme): string {
  const surface = esc(theme.surface);
  const primary = esc(theme.primary);
  const muted = esc(theme.muted);
  switch (style) {
    case "flat":
      return "background:transparent;";
    case "bordered":
      return `background:${surface};border:1px solid ${muted}33;`;
    case "gradient-top":
      return `background:${surface};border-top:3px solid ${primary};box-shadow:var(--lp-shadow);`;
    case "shadow-lift":
    default:
      return `background:${surface};box-shadow:var(--lp-shadow);`;
  }
}

function headingStyle(transform: LandingTemplateConfig["headingTransform"]): string {
  return transform === "uppercase" ? "text-transform:uppercase;letter-spacing:0.03em;" : "";
}

const STYLE = `
  :root{color-scheme:light dark;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--lp-bg);color:var(--lp-text);font-family:var(--lp-font);}
  .lp-wrap{max-width:var(--lp-max-width);margin:0 auto;padding:0 24px;}
  .lp-section{padding:var(--lp-spacing) 0;}
  .lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 28px;font-weight:600;font-size:14px;text-decoration:none;border-radius:var(--lp-radius);background:var(--lp-btn-bg);color:var(--lp-btn-color);border:var(--lp-btn-border,none);}
  .lp-center{text-align:center;}
  .lp-muted{color:var(--lp-muted);}
  h1{font-size:2.6rem;font-weight:800;line-height:1.15;margin:0 0 12px;}
  h2{font-size:1.9rem;font-weight:800;margin:0 0 32px;text-align:center;}
  h3{font-size:1.05rem;font-weight:700;margin:0 0 6px;}
  .lp-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));}
  .lp-card{background:var(--lp-surface);border-radius:var(--lp-radius);box-shadow:var(--lp-shadow);padding:20px;}
  .lp-placeholder{border:2px dashed rgba(128,128,128,0.35);border-radius:var(--lp-radius);color:var(--lp-muted);display:flex;align-items:center;justify-content:center;font-size:13px;padding:40px 16px;}
  .lp-hero-grid{display:grid;gap:32px;grid-template-columns:1fr;align-items:center;}
  @media(min-width:768px){.lp-hero-grid{grid-template-columns:1fr 1fr;}}
  .lp-hero-grid img{width:100%;border-radius:var(--lp-radius);}
  .lp-faq-item{border-bottom:1px solid rgba(128,128,128,0.15);padding:16px 0;}
  .lp-stats{display:grid;gap:24px;grid-template-columns:repeat(2,1fr);text-align:center;}
  @media(min-width:640px){.lp-stats{grid-template-columns:repeat(4,1fr);}}
  .lp-stat-value{font-size:1.9rem;font-weight:800;color:var(--lp-primary);}
  .lp-nav{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid rgba(128,128,128,0.15);}
  .lp-nav a{color:var(--lp-muted);text-decoration:none;margin-left:20px;font-size:14px;}
  .lp-form-field{height:40px;border:1px solid rgba(128,128,128,0.3);border-radius:var(--lp-radius);display:flex;align-items:center;padding:0 12px;color:var(--lp-muted);font-size:14px;margin-bottom:10px;}
  .lp-eyebrow{display:inline-block;color:var(--lp-primary);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;}
  footer{text-align:center;padding:32px 0;border-top:1px solid rgba(128,128,128,0.15);font-size:13px;color:var(--lp-muted);}
`;

function btnAttrs(doc: LandingPageV3): string {
  const t = doc.theme;
  if (t.buttonStyle === "gradient") {
    return `background:linear-gradient(to right, ${esc(t.primary)}, ${esc(t.secondary)});color:#fff;`;
  }
  if (t.buttonStyle === "outline") {
    return `background:transparent;color:${esc(t.primary)};border:2px solid ${esc(t.primary)};`;
  }
  return `background:${esc(t.primary)};color:#fff;`;
}

const PROVENANCE_BADGE_HTML =
  '<span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:2px 6px;border-radius:4px;background:rgba(234,179,8,0.15);color:#eab308;margin-bottom:6px;">Ejemplo — revisar</span>';

function renderSectionHtml(section: LandingSection, btnStyle: string, tpl: LandingTemplateConfig, theme: LandingTheme): string {
  if (!section.visible) return "";
  const c = section.content;
  const hStyle = headingStyle(tpl.headingTransform);
  const gridStyle = gridColsCss(tpl.gridColumns);
  const cardCss = cardStyleCss(tpl.cardStyle, theme);

  switch (section.type) {
    case "announcement_bar":
      return `<div class="lp-center" style="padding:10px 16px;background:var(--lp-primary);color:#fff;font-size:14px;">${esc(c.body)}${
        c.ctaLabel ? ` <a href="${safeHref(c.ctaHref)}" style="color:#fff;text-decoration:underline;">${esc(c.ctaLabel)}</a>` : ""
      }</div>`;

    case "navigation": {
      const brand = `<strong style="${hStyle}">${esc(c.title)}</strong>`;
      const links = (c.navLinks ?? []).map((l) => `<a href="${safeHref(l.href)}">${esc(l.label)}</a>`).join("");
      const cta = c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : "";
      if (tpl.navStyle === "minimal-centered") {
        return `<div class="lp-wrap"><div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 0;text-align:center;border-bottom:1px solid rgba(128,128,128,0.12);">${brand}<nav>${links}</nav></div></div>`;
      }
      if (tpl.navStyle === "boxed") {
        return `<div class="lp-wrap" style="padding:16px 0;"><div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--lp-surface);border-radius:var(--lp-radius);box-shadow:var(--lp-shadow);">${brand}<nav>${links}</nav>${cta}</div></div>`;
      }
      const borderBottom = tpl.navStyle === "bold-underline" ? "2px solid var(--lp-primary)" : "1px solid rgba(128,128,128,0.15)";
      return `<div class="lp-wrap" style="border-bottom:${borderBottom};"><div class="lp-nav" style="border-bottom:none;">${brand}<nav>${links}</nav>${cta}</div></div>`;
    }

    case "hero": {
      const img = safeImgSrc(c.image?.url);
      const visual = img ? `<img src="${img}" alt="${esc(c.image?.alt)}">` : fallbackVisualSvg(tpl.fallbackVisualId, theme, true);
      const textInner = `
          ${c.eyebrow ? `<span class="lp-eyebrow">${esc(c.eyebrow)}</span>` : ""}
          <h1 style="${hStyle}">${esc(c.title)}</h1>
          ${c.subtitle ? `<p class="lp-muted" style="font-size:18px;">${esc(c.subtitle)}</p>` : ""}
          ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
          <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
            ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : ""}
            ${c.secondaryCtaLabel ? `<a href="${safeHref(c.secondaryCtaHref)}" style="padding:14px 8px;font-weight:600;font-size:14px;">${esc(c.secondaryCtaLabel)}</a>` : ""}
          </div>`;
      if (tpl.heroLayout === "centered") {
        return `<div class="lp-wrap lp-section"><div class="lp-center" style="max-width:640px;margin:0 auto;">${textInner}</div></div>`;
      }
      if (tpl.heroLayout === "fullbleed") {
        return `<div class="lp-wrap lp-section"><div style="margin-bottom:32px;">${visual}</div><div class="lp-center" style="max-width:640px;margin:0 auto;">${textInner}</div></div>`;
      }
      if (tpl.heroLayout === "editorial") {
        return `<div class="lp-wrap lp-section"><div class="lp-hero-grid" style="grid-template-columns:1.3fr 1fr;"><div style="border-left:2px solid var(--lp-primary);padding-left:24px;">${textInner}</div>${visual}</div></div>`;
      }
      const order = tpl.heroLayout === "split-left" ? "order:2;" : "";
      const imgOrder = tpl.heroLayout === "split-left" ? "order:1;" : "";
      return `<div class="lp-wrap lp-section"><div class="lp-hero-grid"><div style="${order}">${textInner}</div><div style="${imgOrder}">${visual}</div></div></div>`;
    }

    case "trust_logos":
      return `<div class="lp-wrap lp-section lp-center">
        ${c.title ? `<p class="lp-muted" style="text-transform:uppercase;font-size:12px;margin-bottom:20px;">${esc(c.title)}</p>` : ""}
        ${
          (c.logos ?? []).length
            ? `<div style="display:flex;flex-wrap:wrap;gap:28px;justify-content:center;opacity:0.75;">${c.logos!.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`
            : fallbackLogoRowHtml(theme)
        }
      </div>`;

    case "problem":
    case "solution":
    case "guarantee":
      return `<div class="lp-wrap lp-section lp-center" style="max-width:640px;margin:0 auto;">
        <h2 style="${hStyle}">${esc(c.title)}</h2>
        ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
      </div>`;

    case "benefits":
    case "features":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        <div class="lp-grid" style="${gridStyle}">${(c.items ?? [])
          .map((it) => `<div class="lp-card" style="${cardCss}"><h3>${esc(it.title)}</h3>${it.body ? `<p class="lp-muted">${esc(it.body)}</p>` : ""}</div>`)
          .join("")}</div>
      </div>`;

    case "how_it_works":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.items ?? [])
          .map(
            (it, i) =>
              `<div class="lp-center"><div style="width:36px;height:36px;margin:0 auto 12px;border-radius:var(--lp-radius);background:var(--lp-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">${i + 1}</div><h3>${esc(it.title)}</h3>${it.body ? `<p class="lp-muted">${esc(it.body)}</p>` : ""}</div>`,
          )
          .join("")}</div>
      </div>`;

    case "statistics":
      return `<div class="lp-wrap lp-section"><div class="lp-stats">${(c.stats ?? [])
        .map(
          (s) =>
            `<div>${s.source === "ai_suggested" ? PROVENANCE_BADGE_HTML + "<br>" : ""}<div class="lp-stat-value">${esc(s.value)}</div><div class="lp-muted" style="font-size:12px;">${esc(s.label)}</div></div>`,
        )
        .join("")}</div></div>`;

    case "testimonials":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        <div class="lp-grid" style="${gridStyle}">${(c.testimonials ?? [])
          .map(
            (t) =>
              `<div class="lp-card" style="${cardCss}">${t.source === "ai_suggested" ? PROVENANCE_BADGE_HTML : ""}<p style="font-style:italic;">&ldquo;${esc(t.quote)}&rdquo;</p><p style="font-size:13px;font-weight:600;margin-top:12px;">${esc(t.name)}${t.role ? ` <span class="lp-muted" style="font-weight:400;">· ${esc(t.role)}</span>` : ""}</p></div>`,
          )
          .join("")}</div>
      </div>`;

    case "comparison":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.items ?? [])
          .map((it) => `<div class="lp-card"><h3>${esc(it.title)}</h3><p class="lp-muted">${esc(it.body)}</p></div>`)
          .join("")}</div>
      </div>`;

    case "pricing":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        <div class="lp-grid" style="${gridStyle}">${(c.pricing ?? [])
          .map(
            (tier) => `<div class="lp-card" style="${cardCss}${tier.highlighted ? "border:2px solid var(--lp-primary);" : ""}">
          <h3>${esc(tier.name)}</h3>
          <div style="font-size:1.6rem;font-weight:800;margin:8px 0;">${esc(tier.price)}<span class="lp-muted" style="font-size:14px;font-weight:400;">${esc(tier.period)}</span></div>
          <ul style="list-style:none;padding:0;margin:0 0 16px;font-size:14px;">${tier.features.map((f) => `<li class="lp-muted" style="margin-bottom:6px;">✓ ${esc(f)}</li>`).join("")}</ul>
          <a class="lp-btn" href="#" style="${btnStyle}width:100%;">${esc(tier.ctaLabel)}</a>
        </div>`,
          )
          .join("")}</div>
      </div>`;

    case "offer":
      return `<div class="lp-wrap lp-section"><div class="lp-card lp-center" style="max-width:640px;margin:0 auto;">
        <h2 style="margin-bottom:12px;${hStyle}">${esc(c.title)}</h2>
        ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
        ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}margin-top:16px;">${esc(c.ctaLabel)}</a>` : ""}
      </div></div>`;

    case "faq":
      return `<div class="lp-wrap lp-section" style="max-width:680px;margin:0 auto;">
        ${c.title ? `<h2 style="${hStyle}">${esc(c.title)}</h2>` : ""}
        ${(c.faq ?? []).map((f) => `<div class="lp-faq-item"><h3>${esc(f.q)}</h3><p class="lp-muted">${esc(f.a)}</p></div>`).join("")}
      </div>`;

    case "lead_form":
      return `<div class="lp-wrap lp-section" style="max-width:420px;margin:0 auto;">
        ${c.title ? `<h2 style="font-size:1.4rem;">${esc(c.title)}</h2>` : ""}
        <form class="lp-card">
          ${(c.formFields ?? []).map((f) => `<label><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">${esc(f)}</span><input type="text" placeholder="${esc(f)}" disabled class="lp-form-field" style="width:100%;background:transparent;"></label>`).join("")}
          <button type="submit" disabled title="La captura de leads todavía no está disponible en esta preview" class="lp-btn" style="${btnStyle}width:100%;justify-content:center;border:none;cursor:not-allowed;">${esc(c.ctaLabel || "Enviar")}</button>
        </form>
      </div>`;

    case "final_cta":
      return `<div class="lp-wrap lp-section lp-center">
        <h2 style="${hStyle}">${esc(c.title)}</h2>
        ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : ""}
      </div>`;

    case "footer": {
      if (tpl.footerStyle === "cta-band") {
        return `<div class="lp-wrap" style="padding:48px 0 32px;"><div class="lp-card lp-center" style="margin-bottom:32px;"><p style="font-weight:700;font-size:18px;${hStyle}">${esc(c.title)}</p></div><div class="lp-center" style="font-size:13px;" class="lp-muted">${esc(c.body)}</div></div>`;
      }
      if (tpl.footerStyle === "columns") {
        return `<div class="lp-wrap" style="padding:40px 0;border-top:1px solid rgba(128,128,128,0.15);"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;font-size:13px;"><strong style="color:var(--lp-text);">${esc(c.title)}</strong><span class="lp-muted">${esc(c.body)}</span></div></div>`;
      }
      return `<footer><div class="lp-wrap"><strong style="color:var(--lp-text);display:block;margin-bottom:4px;">${esc(c.title)}</strong>${esc(c.body)}</div></footer>`;
    }

    default:
      return "";
  }
}

export function buildLandingHtml(doc: LandingPageV3): string {
  const btnStyle = btnAttrs(doc);
  const tpl = templateConfig(doc.templateId);
  const body = doc.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => renderSectionHtml(s, btnStyle, tpl, doc.theme))
    .join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(doc.seo.title || doc.metadata.name)}</title>
<meta name="description" content="${esc(doc.seo.description)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${doc.seo.noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
${doc.seo.canonical ? `<link rel="canonical" href="${esc(doc.seo.canonical)}">` : ""}
<meta property="og:title" content="${esc(doc.seo.ogTitle || doc.seo.title)}">
<meta property="og:description" content="${esc(doc.seo.ogDescription || doc.seo.description)}">
${doc.seo.ogImage ? `<meta property="og:image" content="${esc(doc.seo.ogImage)}">` : ""}
<style>${STYLE}</style>
</head>
<body style="${themeCssVarsInline(doc.theme)}">
${body}
</body>
</html>`;
}

export function exportLandingHtml(doc: LandingPageV3) {
  downloadBlob(buildLandingHtml(doc), `${doc.seo.slug || "landing"}.html`, "text/html;charset=utf-8");
}

export function exportLandingJson(doc: LandingPageV3) {
  downloadBlob(JSON.stringify(doc, null, 2), `${doc.seo.slug || "landing"}.json`, "application/json;charset=utf-8");
}
