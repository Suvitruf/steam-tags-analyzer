import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: "list",
  outputDir: "test-results",
  forbidOnly: !!process.env.CI,
});
