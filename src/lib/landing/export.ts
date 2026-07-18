import type { LandingPageV2, LandingSection } from "@/lib/landing/schema";
import { themeCssVarsInline } from "@/lib/landing/themes";

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

function btnAttrs(doc: LandingPageV2): string {
  const t = doc.theme;
  if (t.buttonStyle === "gradient") {
    return `background:linear-gradient(to right, ${esc(t.primary)}, ${esc(t.secondary)});color:#fff;`;
  }
  if (t.buttonStyle === "outline") {
    return `background:transparent;color:${esc(t.primary)};border:2px solid ${esc(t.primary)};`;
  }
  return `background:${esc(t.primary)};color:#fff;`;
}

function renderSectionHtml(section: LandingSection, btnStyle: string): string {
  if (!section.visible) return "";
  const c = section.content;

  switch (section.type) {
    case "announcement_bar":
      return `<div class="lp-center" style="padding:10px 16px;background:var(--lp-primary);color:#fff;font-size:14px;">${esc(c.body)}${
        c.ctaLabel ? ` <a href="${safeHref(c.ctaHref)}" style="color:#fff;text-decoration:underline;">${esc(c.ctaLabel)}</a>` : ""
      }</div>`;

    case "navigation":
      return `<div class="lp-wrap"><div class="lp-nav">
        <strong>${esc(c.title)}</strong>
        <nav>${(c.navLinks ?? []).map((l) => `<a href="${safeHref(l.href)}">${esc(l.label)}</a>`).join("")}</nav>
        ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : ""}
      </div></div>`;

    case "hero": {
      const img = safeImgSrc(c.image?.url);
      return `<div class="lp-wrap lp-section"><div class="lp-hero-grid">
        <div>
          ${c.eyebrow ? `<span class="lp-eyebrow">${esc(c.eyebrow)}</span>` : ""}
          <h1>${esc(c.title)}</h1>
          ${c.subtitle ? `<p class="lp-muted" style="font-size:18px;">${esc(c.subtitle)}</p>` : ""}
          ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
          <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
            ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : ""}
            ${c.secondaryCtaLabel ? `<a href="${safeHref(c.secondaryCtaHref)}" style="padding:14px 8px;font-weight:600;font-size:14px;">${esc(c.secondaryCtaLabel)}</a>` : ""}
          </div>
        </div>
        ${img ? `<img src="${img}" alt="${esc(c.image?.alt)}">` : `<div class="lp-placeholder" style="height:220px;">Imagen de portada pendiente</div>`}
      </div></div>`;
    }

    case "trust_logos":
      return `<div class="lp-wrap lp-section lp-center">
        ${c.title ? `<p class="lp-muted" style="text-transform:uppercase;font-size:12px;margin-bottom:20px;">${esc(c.title)}</p>` : ""}
        ${
          (c.logos ?? []).length
            ? `<div style="display:flex;flex-wrap:wrap;gap:28px;justify-content:center;opacity:0.75;">${c.logos!.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`
            : `<div class="lp-placeholder">Logos pendientes</div>`
        }
      </div>`;

    case "problem":
    case "solution":
    case "guarantee":
      return `<div class="lp-wrap lp-section lp-center" style="max-width:640px;margin:0 auto;">
        <h2>${esc(c.title)}</h2>
        ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
      </div>`;

    case "benefits":
    case "features":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.items ?? [])
          .map((it) => `<div class="lp-card"><h3>${esc(it.title)}</h3>${it.body ? `<p class="lp-muted">${esc(it.body)}</p>` : ""}</div>`)
          .join("")}</div>
      </div>`;

    case "how_it_works":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.items ?? [])
          .map(
            (it, i) =>
              `<div class="lp-center"><div style="width:36px;height:36px;margin:0 auto 12px;border-radius:var(--lp-radius);background:var(--lp-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">${i + 1}</div><h3>${esc(it.title)}</h3>${it.body ? `<p class="lp-muted">${esc(it.body)}</p>` : ""}</div>`,
          )
          .join("")}</div>
      </div>`;

    case "statistics":
      return `<div class="lp-wrap lp-section"><div class="lp-stats">${(c.stats ?? [])
        .map((s) => `<div><div class="lp-stat-value">${esc(s.value)}</div><div class="lp-muted" style="font-size:12px;">${esc(s.label)}</div></div>`)
        .join("")}</div></div>`;

    case "testimonials":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.testimonials ?? [])
          .map(
            (t) =>
              `<div class="lp-card"><p style="font-style:italic;">&ldquo;${esc(t.quote)}&rdquo;</p><p style="font-size:13px;font-weight:600;margin-top:12px;">${esc(t.name)}${t.role ? ` <span class="lp-muted" style="font-weight:400;">· ${esc(t.role)}</span>` : ""}</p></div>`,
          )
          .join("")}</div>
      </div>`;

    case "comparison":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.items ?? [])
          .map((it) => `<div class="lp-card"><h3>${esc(it.title)}</h3><p class="lp-muted">${esc(it.body)}</p></div>`)
          .join("")}</div>
      </div>`;

    case "pricing":
      return `<div class="lp-wrap lp-section">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
        <div class="lp-grid">${(c.pricing ?? [])
          .map(
            (tier) => `<div class="lp-card" style="${tier.highlighted ? "border:2px solid var(--lp-primary);" : ""}">
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
        <h2 style="margin-bottom:12px;">${esc(c.title)}</h2>
        ${c.body ? `<p class="lp-muted">${esc(c.body)}</p>` : ""}
        ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}margin-top:16px;">${esc(c.ctaLabel)}</a>` : ""}
      </div></div>`;

    case "faq":
      return `<div class="lp-wrap lp-section" style="max-width:680px;margin:0 auto;">
        ${c.title ? `<h2>${esc(c.title)}</h2>` : ""}
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
        <h2>${esc(c.title)}</h2>
        ${c.ctaLabel ? `<a class="lp-btn" href="${safeHref(c.ctaHref)}" style="${btnStyle}">${esc(c.ctaLabel)}</a>` : ""}
      </div>`;

    case "footer":
      return `<footer><div class="lp-wrap"><strong style="color:var(--lp-text);display:block;margin-bottom:4px;">${esc(c.title)}</strong>${esc(c.body)}</div></footer>`;

    default:
      return "";
  }
}

export function buildLandingHtml(doc: LandingPageV2): string {
  const btnStyle = btnAttrs(doc);
  const body = doc.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => renderSectionHtml(s, btnStyle))
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

export function exportLandingV2Html(doc: LandingPageV2) {
  downloadBlob(buildLandingHtml(doc), `${doc.seo.slug || "landing"}.html`, "text/html;charset=utf-8");
}

export function exportLandingV2Json(doc: LandingPageV2) {
  downloadBlob(JSON.stringify(doc, null, 2), `${doc.seo.slug || "landing"}.json`, "application/json;charset=utf-8");
}
