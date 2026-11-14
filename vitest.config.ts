import { configDefaults, defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "dist/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "reports/coverage",
      reporter: ["text", ["cobertura", { file: "coverage.xml" }]],
      include: ["packages/*/src/**/*.{ts,tsx}", "plugins/*/*.ts"],
      exclude: ["**/*.d.ts", "**/bin.ts"],
      thresholds: { lines: 80, statements: 70, functions: 70, branches: 60 },
    },
  },
});
