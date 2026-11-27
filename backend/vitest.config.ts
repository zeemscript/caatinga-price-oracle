import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    env: {
      ORACLE_SIGNER_SECRET: "test-placeholder-secret-not-a-real-key",
    },
  },
});
