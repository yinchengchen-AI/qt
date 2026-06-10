// ESLint flat config — uses the next+typescript flat configs shipped by
// `eslint-config-next@16` (which already export flat-config arrays).
//
// Next 16 removed `next lint`; we invoke `eslint .` directly.

import next from "eslint-config-next";
import ts from "eslint-config-next/typescript";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  {
    // 全局 ignore：与 .gitignore 的运行时/工具产物保持一致
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      ".tsbuildinfo",
      "tsconfig.tsbuildinfo",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "shoot.mjs",
      "inspect-dash.mjs",
      "inspect-dash2.mjs"
    ]
  },
  // next 推荐档（含 react / jsx-a11y / @next/eslint-plugin-next）
  ...nextCoreWebVitals,
  // typescript 推荐档（typescript-eslint）
  ...ts,
  // 业务代码微调：以下规则一律降为 warn,不阻塞 lint
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/component-hook-factories": "warn",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/no-deriving-state-in-effects": "warn",
      "react-hooks/memoized-effect-dependencies": "warn",
      "react-hooks/exhaustive-effect-dependencies": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/syntax": "warn",
      "react-hooks/void-use-memo": "warn",
      "react-hooks/memo-dependencies": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/capitalized-calls": "warn",
      "react-hooks/rule-suppression": "warn",
      "react-hooks/todo": "warn",
      "react-hooks/invariant": "warn",
      "prefer-const": "warn",
      "no-empty": "warn",
      // antd / pro-components 内部有 JSX 文本节点含中文标点
      "react/no-unescaped-entities": "off",
      // 项目用 antd 客户端组件渲染链接,不需要 next/link 强制
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];
