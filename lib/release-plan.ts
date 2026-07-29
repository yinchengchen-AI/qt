// 自动发布更新日志的"规划"纯函数(供 scripts/release/publish.ts 使用)
//
// 与 lib/git-format.ts 的分工:
//   - git-format 负责"commits → title/summary/content 文案";
//   - 这里负责发布决策:哪些 commit 不该进更新日志、从哪个 tag 起算、是否标记重要。
// 全部是无 IO 纯函数,方便单测。
import type { GitCommit } from "./git";

// 发版动作自身的 commit 不进更新日志,否则每版都有 "bump to vX.Y.Z" / "版本同步" 噪音。
// 匹配 conventional commits 的 release scope:
//   chore(release): bump to v0.13.1
//   docs(release): v0.13.1 README/CHANGELOG/AGENTS 版本同步
const RELEASE_NOISE_PATTERN = /^(chore|docs|build|ci)\(release\)\s*:/i;

/** 判断一条 commit subject 是否为发版噪音 */
export function isReleaseNoise(subject: string): boolean {
  return RELEASE_NOISE_PATTERN.test(subject.trim());
}

/** 过滤掉发版噪音 commit,保留其余顺序不变 */
export function filterReleaseNoise(commits: GitCommit[]): GitCommit[] {
  return commits.filter((c) => !isReleaseNoise(c.subject));
}

/**
 * 是否标记为"重要更新"(弹窗红色、不可点遮罩关闭)。
 * 规则:任一 commit 带 breaking 标记(`feat!: ...` / `feat(scope)!: ...`,
 * parseCommitSubject 会把 `!` 保留在 description 开头)。
 */
export function shouldMarkImportant(commits: GitCommit[]): boolean {
  return commits.some((c) => c.description.startsWith("!"));
}

/**
 * 从 release tag 列表(新→旧)和当前版本 tag 算出 git log 的起始 ref:
 *   - 当前版本已打 tag(npm version 之后):取它的前一个 tag,即"上一版 → 本版"区间;
 *   - 当前版本还没 tag(手动提前跑):取最新 tag;
 *   - 仓库一个 v* tag 都没有:返回 null,调用方用 maxCount 兜底。
 */
export function planFromTag(tags: string[], currentVersionTag: string): string | null {
  const idx = tags.indexOf(currentVersionTag);
  if (idx >= 0) return tags[idx + 1] ?? null;
  return tags[0] ?? null;
}
