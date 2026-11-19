import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173/bob-gacha/";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
  },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4173 --strictPort",
    url: baseURL,
  },
});
