// 把 GitCommit[] 变成 release 的 title / summary / content
//
// 设计原则:
//   - "省心易懂":commit subject 已经很口语化 (项目用 conventional commits + 中文描述),
//     这里只做两件事:(1) 按 type 分节,每节给一个中文小标题;(2) 给出"概要",让人 5 秒扫到重点。
//   - 内容只保留 description (scope 过长会忽略,放在括号里)。
//   - emoji 不引入;与项目现有文案风格保持一致。
import type { GitCommit, CommitCategory } from "./git";

export type FormattedRelease = {
  /** e.g. "v0.7.1 更新说明" */
  title: string;
  /** e.g. "本次更新包含 3 个新功能、 1 个问题修复和 1 项内部维护" */
  summary: string;
  /** e.g. "新功能\n- ...\n- ...\n\n问题修复\n- ..." */
  content: string;
  /** 各分类的提交数,供脚本日志输出 */
  categoryCounts: Array<{ label: string; order: number; count: number }>;
};

/** 按 category.order 排序,再按 order 升序输出各组 */
export function formatReleaseContent(opts: {
  version: string;
  commits: GitCommit[];
}): FormattedRelease {
  const { commits, version } = opts;

  if (commits.length === 0) {
    return {
      title: `${version} 更新说明`,
      summary: "本次无任何变化",
      content: "本次无任何变化",
      categoryCounts: []
    };
  }

  // 分组:同一 category.label 的 commits 放一起
  const groups = new Map<string, { category: CommitCategory; commits: GitCommit[] }>();
  for (const c of commits) {
    const key = c.category.label;
    const g = groups.get(key) ?? { category: c.category, commits: [] };
    g.commits.push(c);
    groups.set(key, g);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.category.order - b.category.order);

  // 概要:只取前三类 (count > 0),多了太长
  const summaryParts = sortedGroups.slice(0, 3).map((g) => {
    const n = g.commits.length;
    const unit = pickUnit(n);
    return `${n} ${unit}${g.category.label}`;
  });
  const summary = `本次更新包含 ${summaryParts.join("、")}${sortedGroups.length > 3 ? " 等" : ""}`;

  // 标题:包含版本号 + 数量提示 (让人一眼看到这版本有啥)
  const total = commits.length;
  const totalUnit = pickUnit(total);
  const title = `${version} 更新说明 · 共 ${total} ${totalUnit}提交`;

  // 正文:每组一节,每条一行
  const contentLines: string[] = [];
  for (const g of sortedGroups) {
    contentLines.push(g.category.label);
    for (const c of g.commits) {
      // 优先用 description;带 scope 时带括号,方便过滤
      const head = c.scope ? `(${c.scope})` : "";
      contentLines.push(`- ${c.description.trim()}${head}`);
    }
    contentLines.push("");
  }
  while (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
    contentLines.pop();
  }
  const content = contentLines.join("\n");

  return {
    title,
    summary,
    content,
    categoryCounts: sortedGroups.map((g) => ({
      label: g.category.label,
      order: g.category.order,
      count: g.commits.length
    }))
  };
}

/** "1 个新功能" / "3 个新功能" / "0 项新功能" ... 量词按数取 */
function pickUnit(n: number): string {
  return n === 1 ? "个" : "项";
}
