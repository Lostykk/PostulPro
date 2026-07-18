import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the Lovable -> native Supabase Google OAuth
// migration: nothing under src/ may import Lovable's auth SDK or call the
// old lovable.auth.signInWithOAuth helper, so Google login can never again
// silently depend on Lovable's edge proxy.
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Lovable auth SDK is fully retired", () => {
  const files = collectSourceFiles(join(__dirname, "..", "..", "..", "src"));

  it("no source file imports @lovable.dev/cloud-auth-js", () => {
    const offenders = files.filter((f) =>
      readFileSync(f, "utf8").includes("@lovable.dev/cloud-auth-js"),
    );
    expect(offenders).toEqual([]);
  });

  it("no source file calls the retired lovable.auth.signInWithOAuth helper", () => {
    const offenders = files.filter((f) =>
      readFileSync(f, "utf8").includes("lovable.auth.signInWithOAuth"),
    );
    expect(offenders).toEqual([]);
  });
});
