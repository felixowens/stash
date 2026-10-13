import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.STASH_CLIP_FEED_URL ??
  execFileSync("../../scripts/dev-instance.sh", ["url"], {
    encoding: "utf8",
  }).trim();

export default defineConfig({
  testDir: "./tests/clip-feed",
  outputDir: "./test-results/clip-feed",
  timeout: 30000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Touch/layout coverage in Chromium, not an iOS Safari reproduction.
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
