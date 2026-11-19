import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

import svelteConfig from "./svelte.config.js";

export default defineConfig(
  globalIgnores(["dist/", "playwright-report/", "test-results/"]),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    files: ["src/**/*.{ts,svelte}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: { parser: ts.parser, svelteConfig },
    },
  },
);
