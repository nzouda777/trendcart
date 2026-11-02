import path from "node:path";

import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.join(root, "$1") },
      // `server-only` throws outside React Server Components; tests are server code.
      { find: /^server-only$/, replacement: path.join(root, "lib/db/server-only-stub.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "claude-2/**"],
    testTimeout: 30_000,
    // PGlite databases are built in beforeAll; slow when several suites run at once.
    hookTimeout: 240_000,
    // Each PGlite instance is memory-hungry; too many in parallel crash with OOM.
    maxWorkers: 2,
  },
});
