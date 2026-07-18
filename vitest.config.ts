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
  },
});
