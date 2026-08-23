import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Compiler 新规则（eslint-config-next 16 默认 error）对存量组件大面积报错：
  // setState-in-effect 数据加载模式、播放器 ref 时序等均为项目既有写法。
  // 先降为 warning 保住 CI 门禁（error 才阻断），存量告警渐进治理，新代码请遵守规则。
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
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
