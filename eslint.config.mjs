import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // SPA frontend (has its own eslint/tsconfig via Vite)
    "frontend/**",
    // Ignore reference source, simulator, generated code, and CommonJS modules
    "lx-env-simulator/**",
    "lx-music-desktop-master/**",
    "lib/generated/**",
    "lib/music-core/**",
    "scripts/**",
    // Local third-party music source scripts (CommonJS, executed via vm at runtime)
    "custom-sources/**",
  ]),
]);

export default eslintConfig;
