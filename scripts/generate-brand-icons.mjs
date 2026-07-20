// One-off generator for PostulPro's favicon/app-icon assets, run manually
// (not part of the build). Renders public/logo-mark.svg at exact pixel
// sizes via a real browser (Playwright/Chromium) so every output is a
// pixel-perfect raster of the same vector source — never an upscaled or
// blurry crop. Regenerate by re-running this script if logo-mark.svg
// ever changes; nothing here runs automatically at build time.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Minimal ICO container builder (no extra dependency needed) — modern ICO
// readers accept raw embedded PNG data per entry, which is all a favicon
// needs; avoids hand-rolling the legacy uncompressed BMP format.
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const imageChunks = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    imageChunks.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...dirEntries, ...imageChunks]);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const markSvg = readFileSync(path.join(root, "public", "logo-mark.svg"), "utf-8");

function pageHtml(size, { bg } = {}) {
  const bgStyle = bg ? `background:${bg};border-radius:${Math.round(size * 0.22)}px;` : "background:transparent;";
  const pad = bg ? Math.round(size * 0.16) : 0;
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;}
    .wrap{width:${size}px;height:${size}px;${bgStyle}display:flex;align-items:center;justify-content:center;}
    svg{width:${size - pad * 2}px;height:${size - pad * 2}px;}
  </style></head><body><div class="wrap">${markSvg}</div></body></html>`;
}

const targets = [
  { name: "favicon-16.png", size: 16, bg: "#0B0B14" },
  { name: "favicon-32.png", size: 32, bg: "#0B0B14" },
  { name: "favicon-48.png", size: 48, bg: "#0B0B14" },
  { name: "favicon-256.png", size: 256, bg: "#0B0B14" },
  { name: "apple-touch-icon.png", size: 180, bg: "#0B0B14" },
  { name: "icon-192.png", size: 192, bg: "#0B0B14" },
  { name: "icon-512.png", size: 512, bg: "#0B0B14" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const outDir = path.join(root, "public");

for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(pageHtml(t.size, { bg: t.bg }));
  await page.screenshot({ path: path.join(outDir, t.name), omitBackground: false });
  console.log("wrote", t.name);
}

// favicon.svg — the vector version browsers prefer when they support
// rel="icon" type="image/svg+xml", on the same dark rounded backdrop as
// the raster favicons for consistent tab-bar contrast in both themes.
await page.setViewportSize({ width: 64, height: 64 });
await page.setContent(pageHtml(64, { bg: "#0B0B14" }));
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0B0B14"/>
  <g transform="translate(10,10) scale(1.375)">
    ${markSvg.replace(/<svg[^>]*>/, "").replace("</svg>", "")}
  </g>
</svg>`;
writeFileSync(path.join(outDir, "favicon.svg"), faviconSvg);
console.log("wrote favicon.svg");

await browser.close();

// favicon.ico — multi-resolution (16/32/48/256), embedding the PNGs
// generated above (see buildIco above for why this needs no extra dep).
const icoBuffer = buildIco(
  [16, 32, 48, 256].map((size) => ({
    size,
    data: readFileSync(path.join(outDir, `favicon-${size}.png`)),
  })),
);
writeFileSync(path.join(outDir, "favicon.ico"), icoBuffer);
console.log("wrote favicon.ico");
