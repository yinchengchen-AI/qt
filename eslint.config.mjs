// ESLint flat config — uses the next+typescript flat configs shipped by
// `eslint-config-next@16` (which already export flat-config arrays).
//
// Next 16 removed `next lint`; we invoke `eslint .` directly.

import ts from "eslint-config-next/typescript";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import reactHooks from "eslint-plugin-react-hooks";

const config = [
  {
    // 全局 ignore:与 .gitignore 的运行时/工具产物保持一致
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
      ".qt-screenshots/**",
      "inspect-dash.mjs",
      "inspect-dash2.mjs",
      "scripts/_*.mjs"
    ]
  },
  // next 推荐档(含 react / jsx-a11y / @next/eslint-plugin-next)
  ...nextCoreWebVitals,
  // 显式注册 react-hooks 插件,让后面的 react-hooks/* 规则名可解析
  { plugins: { "react-hooks": reactHooks } },
  // typescript 推荐档(typescript-eslint)
  ...ts,
  // 业务代码微调:以下规则一律降为 warn,不阻塞 lint
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
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/static-components": "off",
      "react-hooks/component-hook-factories": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/no-deriving-state-in-effects": "off",
      "react-hooks/memoized-effect-dependencies": "off",
      "react-hooks/exhaustive-effect-dependencies": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
      "react-hooks/globals": "off",
      "react-hooks/syntax": "off",
      "react-hooks/void-use-memo": "off",
      "react-hooks/memo-dependencies": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/capitalized-calls": "off",
      "react-hooks/rule-suppression": "off",
      "react-hooks/todo": "off",
      "react-hooks/invariant": "off",
      "prefer-const": "warn",
      "no-empty": "warn",
      // antd / pro-components 内部有 JSX 文本节点含中文标点
      "react/no-unescaped-entities": "off",
      // 项目用 antd 客户端组件渲染链接,不需要 next/link 强制
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];

export default config;
