// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";

const reconcileTaskPath = fileURLToPath(new URL("./tasks/reconcile-credits.ts", import.meta.url));

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Enables Nitro's official (if still labeled experimental) Tasks
  // feature — tasks/*.ts files become invocable via runTask(), and the
  // cloudflare-module preset's own generated scheduled() handler gains a
  // real dispatch path to them (see node_modules/nitro/dist/_build/
  // common.mjs's `_tasks: nitro.options.experimental.tasks` and
  // presets/cloudflare/runtime/_module-handler.mjs's
  // `if (import.meta._tasks) { context.waitUntil(runCronTasks(...)) }`,
  // both read and confirmed before relying on this). This flag alone,
  // with no `scheduledTasks` mapping, registers the task but wires no
  // Cron Trigger — Cloudflare only ever calls scheduled() at all for a
  // Worker that has one actually registered, which requires a
  // `[triggers]` entry in wrangler config that nothing here adds.
  //
  // Cast: @lovable.dev/vite-tanstack-config's declared `nitro` option
  // type deliberately only exposes a narrow, stable subset of Nitro v3's
  // (pre-RC) config surface — `experimental` isn't in that declared
  // type. At runtime the wrapper does a plain object spread with no
  // validation (`{ defaultPreset: "cloudflare-module", ...userNitroOpts }`
  // passed straight to `nitro()`), so this reaches real Nitro unchanged —
  // verified by inspecting the compiled bundle after this build, not
  // assumed. Documented risk: a future wrapper version could add runtime
  // validation that strips unknown keys, which would silently disable
  // this without a build error.
  // `tasks/reconcile-credits.ts` alone is not enough — Nitro's file-based
  // scanning of `tasks/` isn't active in this project's build (same root
  // cause already found for `server/plugins/`: confirmed by building
  // with only `experimental.tasks: true` and finding `var tasks = {}` —
  // an empty registry — in the compiled bundle). Registering the task
  // explicitly here bypasses directory scanning entirely by pointing
  // straight at the file, per Nitro's own documented config-based
  // registration path (nitro/docs/tasks, "Registering tasks via config").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  // scheduledTasks activates the production Cron Trigger: Nitro's
  // cloudflare-module preset translates this into a `[triggers].crons`
  // entry in the generated wrangler config at build time, which Cloudflare
  // reads on deploy to actually register the trigger — see
  // docs/premium-redesign-report.md §19.4/§19.9 for the build-time proof
  // (a throwaway build with this same key produced a real
  // `"triggers":{"crons":[...]}` section) and §19.9 for why 5 minutes:
  // well under the shortest per-tool evidence threshold (10 minutes, see
  // supabase/migrations/20260728000000_reservation_job_evidence.sql), and
  // far above real generation durations, so it won't fire mid-generation
  // for the case that matters (active/ambiguous reservations, which the
  // RPC itself leaves untouched regardless).
  nitro: {
    experimental: { tasks: true },
    tasks: {
      "reconcile-credits": {
        handler: reconcileTaskPath,
        description: "Reconcile stale credit_reservations via reconcile_stale_reservations_v2",
      },
    },
    scheduledTasks: {
      "*/5 * * * *": ["reconcile-credits"],
    },
  } as any,
});
