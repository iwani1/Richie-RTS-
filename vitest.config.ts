import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// The product suite is everything under src/.
//
// audit/probes/ holds the harness used for the independent audit (permission sweeps,
// proof-of-concept cases and a deliberate latency benchmark). It is reference material, not
// part of the product's gates: the benchmark takes ~28s on purpose, so it must not run in
// `npm test` or in CI. Run it explicitly when reproducing an audit finding.
const auditHarness = "audit/**";

// Coverage thresholds are a ratchet: they sit just under the levels the suite reaches today
// (72% statements, 65% branches on Vitest 5's all-files basis), so a change that drops
// coverage fails CI instead of passing quietly. Raise them as coverage improves.
export default defineConfig({
  // The components are written for the automatic JSX runtime (Next). Vitest has no React plugin
  // any more, so the transform is told the same thing the Next compiler does.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(root, "src") } },
  test: {
    exclude: ["node_modules/**", "dist/**", auditHarness],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // What is excluded, and why:
      //   src/main.tsx            — a mount call, no logic.
      //   src/test/**             — the fake API used by the UI tests.
      //   src/server/{db,repository,commands,session,api}.ts and src/app/** — these need a live
      //     PostgreSQL or a Next request context. They are covered by the integration suite
      //     (src/server/*.integration.test.ts, `npm run test:integration`) and by the deployment
      //     smoke test in docs/SETUP_AND_DEPLOYMENT.md, not by jsdom unit tests.
      //   src/tms/clientCommand.ts — types only; it erases to an empty module.
      exclude: [
        "src/main.tsx",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/tms/clientCommand.ts",
        "src/server/db.ts",
        "src/server/repository.ts",
        "src/server/commands.ts",
        "src/server/session.ts",
        "src/server/api.ts",
        "src/app/**",
      ],
      thresholds: { statements: 70, branches: 62, functions: 66, lines: 74 },
    },
  },
});
