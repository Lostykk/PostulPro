import type { LandingPageData } from "@/lib/deliverables/parse-landing";
import type { ParsedSection } from "@/lib/ai/parse-sections";

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// Self-contained HTML export — inline CSS, no external assets. The hero
// image is always the explicit placeholder unless the user has typed a real
// URL in the editor (see LandingPageView) — never a fabricated image URL.
export function exportLandingHtml(data: LandingPageData, heroImageUrl?: string) {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.meta_title || data.headlines[0] || "Landing Page")}</title>
<meta name="description" content="${escapeHtml(data.meta_description)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#0b0b12; color:#f4f4f6; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 0 24px; }
  .hero { padding: 72px 0 48px; text-align: center; }
  .hero img { width:100%; max-width:640px; border-radius:16px; margin-bottom:28px; }
  .placeholder { width:100%; max-width:640px; height:280px; border-radius:16px; margin:0 auto 28px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.06); border:1px dashed rgba(255,255,255,0.25); color:#9a9aa8; font-size:14px; }
  h1 { font-size: 2.4rem; font-weight:800; margin:0 0 12px; }
  .sub { font-size:1.1rem; color:#c3c3cf; max-width:640px; margin:0 auto 24px; }
  .cta { display:inline-block; padding:14px 28px; border-radius:12px; background:linear-gradient(90deg,#8b5cf6,#d946ef); color:white; font-weight:700; text-decoration:none; }
  .features { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); padding:48px 0; }
  .feature { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:20px; }
  .proof { padding:32px 0; text-align:center; color:#c3c3cf; font-style:italic; }
  .faq { padding:32px 0; }
  .faq-item { border-bottom:1px solid rgba(255,255,255,0.08); padding:16px 0; }
  .faq-item h3 { margin:0 0 6px; font-size:1rem; }
  .faq-item p { margin:0; color:#c3c3cf; font-size:0.95rem; }
  footer { padding:32px 0 64px; text-align:center; }
  .footer-note { color:#6b6b78; font-size:0.8rem; margin-top:24px; }
</style>
</head>
<body>
<div class="wrap">
  <section class="hero">
    ${heroImageUrl ? `<img src="${escapeHtml(heroImageUrl)}" alt="">` : `<div class="placeholder">Imagen hero — reemplazar antes de publicar</div>`}
    <h1>${escapeHtml(data.headlines[0] ?? "")}</h1>
    <p class="sub">${escapeHtml(data.subheadline)}</p>
    <p class="sub">${escapeHtml(data.hero)}</p>
    <a class="cta" href="#cta">${escapeHtml(data.cta || "Empezar ahora")}</a>
  </section>
  ${
    data.features.length
      ? `<section class="features">${data.features.map((f) => `<div class="feature">${escapeHtml(f)}</div>`).join("")}</section>`
      : ""
  }
  ${data.social_proof ? `<section class="proof">${escapeHtml(data.social_proof)}</section>` : ""}
  ${
    data.faq.length
      ? `<section class="faq"><h2>Preguntas frecuentes</h2>${data.faq
          .map(
            (f) =>
              `<div class="faq-item"><h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p></div>`,
          )
          .join("")}</section>`
      : ""
  }
  <footer id="cta">
    <a class="cta" href="#">${escapeHtml(data.cta || "Empezar ahora")}</a>
    <p class="footer-note">Generado con PostulPro — revisá y personalizá antes de publicar.</p>
  </footer>
</div>
</body>
</html>`;
  downloadBlob(html, "landing-page.html", "text/html;charset=utf-8");
}

export function exportLandingJson(data: LandingPageData) {
  downloadBlob(
    JSON.stringify(data, null, 2),
    "landing-page.json",
    "application/json;charset=utf-8",
  );
}

export function exportSectionsTxt(sections: ParsedSection[], filenamePrefix: string) {
  const text = sections
    .map((s) => {
      const lines = [s.title];
      if (s.fields.subject) lines.push(`Asunto: ${s.fields.subject}`);
      if (s.fields.preview) lines.push(`Preview: ${s.fields.preview}`);
      lines.push("", s.body);
      if (s.fields.cta) lines.push("", `CTA: ${s.fields.cta}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
  downloadBlob(text, `${filenamePrefix}.txt`, "text/plain;charset=utf-8");
}

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function exportSectionsCsv(sections: ParsedSection[], filenamePrefix: string) {
  const header = ["title", "subject", "preview", "body", "cta"];
  const rows = sections.map((s) =>
    [s.title, s.fields.subject ?? "", s.fields.preview ?? "", s.body, s.fields.cta ?? ""]
      .map(csvEscape)
      .join(","),
  );
  downloadBlob(
    [header.join(","), ...rows].join("\n"),
    `${filenamePrefix}.csv`,
    "text/csv;charset=utf-8",
  );
}
