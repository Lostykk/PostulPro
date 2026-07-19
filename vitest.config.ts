import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config, deliberately not extending vite.config.ts —
// that file wraps @lovable.dev/vite-tanstack-config's TanStack Start SSR
// setup, which unit tests have no business pulling in. Just the "@" alias
// (mirrors tsconfig's paths) so lib modules import the same way in tests
// as they do in the app.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Several suites spin up a real (WASM) PGlite Postgres instance per
    // test for local migration dry-runs (never the shared remote
    // Supabase project — see src/lib/hotmart/hotmart-events-migration.test.ts
    // and sibling files). Four such suites now run concurrently across
    // vitest's worker pool; each individual test is fast once its own
    // instance is up, but instantiating several WASM engines at once can
    // exceed the 10s default hook timeout under load — confirmed by every
    // affected suite passing 100% when run alone. Raising this here (not
    // per-file) keeps the fix in one place as more such suites are added.
    hookTimeout: 30_000,
  },
});
