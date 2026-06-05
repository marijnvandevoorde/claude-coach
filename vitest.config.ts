import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Many DB tests set process.env.HOME to a temp dir (the SQLite path derives from
    // it) and run a full migrate() in beforeAll. Run each file in its own process so
    // that global env can't race across files, and give the DB-heavy hooks headroom
    // under parallel load (a shared-process/threads run made beforeAll time out).
    pool: "forks",
    hookTimeout: 30000,
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
