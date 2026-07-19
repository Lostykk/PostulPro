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
    // and sibling files). With five such suites now in the tree, running
    // them all concurrently across vitest's default worker-fork pool
    // pushed past a 10s hook timeout under load first (raised below), and
    // then caused an outright V8 OOM crash in a worker process — too many
    // WASM Postgres engines instantiating at once for the machine running
    // these tests, not a logic bug in any suite (every affected suite
    // passes 100% run alone or in a small group). Capping maxForks keeps
    // total concurrent memory pressure bounded as more such suites are
    // added, instead of raising timeouts indefinitely.
    hookTimeout: 30_000,
    // maxForks alone (tried 4, then 2) still hit an intermittent V8 OOM
    // crash in a worker process — the failure came back non-deterministically
    // even at maxForks: 2, meaning this isn't purely "too many concurrent
    // WASM instances" but likely WASM memory not being fully released
    // back to the OS between PGlite instances within a single long-lived
    // worker process across many test files. Forcing a single fork trades
    // parallelism speed for reliability — confirmed stable across repeated
    // full-suite runs where maxForks: 2 still intermittently crashed.
    fileParallelism: false,
  },
});
