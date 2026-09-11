import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/emulator/**", "tests/e2e/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
