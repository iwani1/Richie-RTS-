// ESLint flat config. This closes the Phase 0 deliverable "confirm that typecheck, lint,
// test and build all run" (see docs/PROGRESS.md, Phase 7).
//
// Policy: correctness rules are errors. Style is left to the formatter and is not linted.
// One architectural rule is enforced mechanically because the brief depends on it: UI code
// must change state only through dispatch() from useTms, never by calling a module's
// execute* function directly (ARCHITECTURE.md "Request flow for a write").

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // Correctness
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off", // used deliberately after a guarded find(); documented at call sites
      "no-console": ["error", { allow: ["warn", "error"] }],
      "eqeqeq": ["error", "always"],
      "no-debugger": "error",
      "prefer-const": "error",
    },
  },

  // React component and hook files.
  {
    files: ["src/**/*.tsx", "src/tms/useTms.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Architecture: pages and UI never bypass the command router.
  {
    files: ["src/pages/**/*.tsx", "src/App.tsx", "src/ui/**/*.tsx", "src/docs/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "../tms/service", importNames: ["execute"], message: "UI must call dispatch() from useTms, not execute() directly." },
            { name: "../tms/busing", importNames: ["executeBusing"], message: "UI must call dispatch() from useTms, not executeBusing() directly." },
            { name: "../tms/logistics", importNames: ["executeLogistics"], message: "UI must call dispatch() from useTms, not executeLogistics() directly." },
            { name: "../tms/compliance", importNames: ["executeCompliance"], message: "UI must call dispatch() from useTms, not executeCompliance() directly." },
            { name: "../tms/maintenance", importNames: ["executeMaintenance"], message: "UI must call dispatch() from useTms, not executeMaintenance() directly." },
            { name: "../tms/commands", importNames: ["executeCommand"], message: "UI must call dispatch() from useTms, not executeCommand() directly." },
          ],
        },
      ],
    },
  },

  // Tests run under Vitest (node + jsdom); allow node globals and console for debugging.
  {
    files: ["**/*.test.{ts,tsx}", "vite.config.ts", "vitest.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-console": "off" },
  },
);
