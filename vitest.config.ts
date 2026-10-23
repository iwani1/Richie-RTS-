import { defineConfig } from "vitest/config";

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
  test: {
    exclude: ["node_modules/**", "dist/**", auditHarness],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/**/*.test.{ts,tsx}"],
      thresholds: { statements: 70, branches: 62, functions: 66, lines: 74 },
    },
  },
});
