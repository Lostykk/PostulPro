import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regression guard: RESEND_API_KEY must only ever be read from
// lib/resend.server.ts (server-only, never bundled to the client). Any
// other reference — especially a VITE_-prefixed one, which Vite inlines
// into the client bundle at build time — would be a real secret leak.

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectSourceFiles(full, out);
    else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    )
      out.push(full);
  }
  return out;
}

describe("RESEND_API_KEY never reaches client code", () => {
  const files = collectSourceFiles(join(__dirname, "..", "..", "..", "src"));

  it("process.env.RESEND_API_KEY is only read in server-only modules", () => {
    const offenders = files.filter((f) => {
      const isServerLib = f.endsWith(".server.ts") || f.endsWith(".server.tsx");
      const isApiRoute = f.includes(join("src", "routes", "api"));
      if (isServerLib || isApiRoute) return false;
      return /process\.env\.RESEND_API_KEY/.test(readFileSync(f, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("is never exposed as a VITE_-prefixed variable anywhere in src/", () => {
    const offenders = files.filter((f) => /VITE_RESEND/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is only imported from server-only modules: lib/*.server.ts or routes/api/* route handlers", () => {
    const offenders = files.filter((f) => {
      const isServerLib = f.endsWith(".server.ts") || f.endsWith(".server.tsx");
      const isApiRoute = f.includes(`${join("src", "routes", "api")}`);
      if (isServerLib || isApiRoute) return false;
      const content = readFileSync(f, "utf8");
      return /from ["']@\/lib\/resend\.server["']/.test(content);
    });
    expect(offenders).toEqual([]);
  });
});
