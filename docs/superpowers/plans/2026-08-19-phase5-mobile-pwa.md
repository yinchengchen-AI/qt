# Phase 5 移动端适配 + PWA — 实现计划

> 日期：2026-08-19
> Spec：`docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md` §8
> 前置：工作台/详情页均已单栏响应式；E2E 已有三 project 双端断点
> 验收锚点（spec §13 Phase 5）：工作台/详情/消息三页在 iPhone 13 / iPad 竖屏布局正常；PWA 可添加到主屏幕；推送不可用时站内信兜底
> 提交计划：单个 `feat(mobile): ...` commit + `npm version patch` + CHANGELOG（不 push 不部署）

## 范围（验收驱动，不做过度设计）

1. **PWA 可安装**：
   - `app/manifest.ts`（名称/图标/theme_color/display: standalone）
   - Service Worker（`public/sw.js` + 客户端注册）：仅做应用壳缓存与离线兜底页，**不拦截 API**（避免会话/数据陈旧风险；推送不在本期，站内信为准——spec §8.3 明确 PWA 推送只是增强通道）
   - 图标：复用 `public/` 现有品牌 logo 生成 192/512 规格（无则 SVG 占位声明 maskable）
2. **移动端底部固定导航**（`components/mobile-bottom-nav.tsx`，仅 `isPhone` 渲染）：
   - 工作台（/contracts/workbench）/ 合同（/contracts）/ 消息（/messages）/ 我的（/profile 或 dashboard 兜底）
   - 挂入 dashboard-shell Content 底部，主内容加 bottom padding 防遮挡
3. **风险报告移动端降级**（spec §8.2）：`RiskReportView` 在手机端把 Radar 雷达图换成纵向条形图（Column），其余不变
4. **工作台统计卡 2×2**（spec §8.2）：`StatGrid` 增加可选 `mobileColumns?: 1|2`（默认 1 保持现状零影响），工作台页传 2
5. **测试**：
   - 单测：无（纯展示层）
   - E2E `tests/e2e/20-mobile-pwa.spec.ts`：iphone-13 + ipad-portrait 实际断点下——工作台（统计卡 2 列网格/底部导航可见可跳转）/ 合同详情（风险分析区块条形图、无横向滚动条）/ 消息页（列表渲染）；manifest 可达 + SW 注册脚本存在
6. **验证**：typecheck + lint + vitest + E2E 全 project

## 明确不做（本期）
- Web Push 推送（spec：仅增强通道，关键提醒以站内信为准；iOS 16.4+ 且需用户手动加主屏，不做唯一依赖）
- 下拉刷新、消息列表滑动操作（P2 体验项，验收未要求）
- 小程序（远期 P2）
- Phase 4b LLM 增强（需外部 API key + 数据出域评审，待用户决策）
