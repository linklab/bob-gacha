import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/bob-gacha/",
  plugins: [svelte()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
