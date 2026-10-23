import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Integration tests talk to a real PostgreSQL instance. They are deliberately separate from
// `npm test`, because they need a database and they truncate it:
//
//   TEST_DATABASE_URL="postgresql://richie:...@127.0.0.1:5432/richie_tms_test" npm run test:integration
//
// Use a scratch database. Without TEST_DATABASE_URL every test is skipped, not silently passed.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(root, "src") } },
  test: {
    include: ["src/server/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { enabled: false },
    // The suites talk to PostgreSQL directly; they still need a valid server configuration because
    // they import the same modules the API uses.
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "integration-test-only-secret-at-least-32-characters",
    },
  },
});
