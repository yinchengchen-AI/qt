// Git 日志解析 + 提交信息分类(供 scripts/release/generate.ts 使用)
//
// 设计要点:
//   - 不引第三方库,只用 child_process + 正则,跟项目其它脚本风格一致
//   - commit 解析认 conventional commits (`<type>(<scope>): <subject>`),
//     兼容纯文本标题(没有 type 前缀也允许,归类为 "chore" 兜底)
//   - 中文分类标签 (feat → 新功能) 在这里集中维护,以后想换 i18n 也好找
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** git 提交记录(精简版,只装生成 release 用的字段) */
export type GitCommit = {
  sha: string;
  shortSha: string;
  /** 原始 commit subject 第一行 */
  subject: string;
  /** ISO 时间 */
  date: string;
  /** 解析出的 type,例如 feat / fix / chore;无 type 时为 null */
  type: string | null;
  /** 解析出的 scope,例如 customers / invoices;无 scope 时为 null */
  scope: string | null;
  /** 解析出的 description:type/scope 之外的部分 */
  description: string;
  /** 按 type 归类后的中文桶(generate.ts 用它来分节输出) */
  category: CommitCategory;
};

/** 归类桶(中文标签 + 排序权重) */
export type CommitCategory = {
  /** 中文节标题,例如 "新功能" */
  label: string;
  /** 排序用,数字小的排前面 */
  order: number;
};

const CATEGORY_MAP: Record<string, CommitCategory> = {
  feat:     { label: "新功能",     order: 1 },
  fix:      { label: "问题修复",   order: 2 },
  perf:     { label: "性能优化",   order: 3 },
  refactor: { label: "代码优化",   order: 4 },
  ui:       { label: "界面改进",   order: 5 },
  docs:     { label: "文档更新",   order: 6 },
  test:     { label: "测试",       order: 7 },
  build:    { label: "构建相关",   order: 8 },
  ci:       { label: "CI/CD",      order: 9 },
  chore:    { label: "内部维护",   order: 10 },
  revert:   { label: "回滚",       order: 11 }
};

/** 兜底分类:解析不出 type 时 */
const FALLBACK_CATEGORY: CommitCategory = { label: "其它变更", order: 99 };

/** 暴露给测试 / 第三方使用: 根据 type 拿到 category 元数据 */
export function categoryForType(type: string | null): CommitCategory {
  if (!type) return FALLBACK_CATEGORY;
  return CATEGORY_MAP[type] ?? FALLBACK_CATEGORY;
}

/**
 * 跑 git log 取指定区间内的 commit。
 *
 *  - from / to 接受 SHA / tag / branch / HEAD;
 *  - 不传 from 时,git 默认从 repo 根开始,可能拉太多,所以调用方应显式传
 *  - 返回的顺序是"新→旧"(git log 默认),便于生成 release 时"重要更新"在前
 *
 * 抛错策略:执行失败(exit code != 0)直接抛 Error,不让脚本静默吞掉,
 * 调用方应 try/catch 后决定如何提示。
 */
export function getCommitsInRange(opts: { from?: string; to?: string; cwd?: string; maxCount?: number }): GitCommit[] {
  const args = [
    "log",
    "--no-merges",
    "--pretty=format:%H%x1f%h%x1f%s%x1f%aI"
  ];
  if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
  if (opts.from) args.push(`${opts.from}..${opts.to ?? "HEAD"}`);
  else if (opts.to) args.push(opts.to);

  const out = execFileSync("git", args, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  });

  if (!out.trim()) return [];
  return out.split("\n").filter(Boolean).map((line) => parseGitLogLine(line));
}

/**
 * 解析 git log --pretty=format 的一行
 * 字段顺序: SHA, shortSHA, subject, ISO date — 用 US (\x1f) 分隔
 */
function parseGitLogLine(line: string): GitCommit {
  const [sha = "", shortSha = "", subject = "", date = ""] = line.split("\x1f");
  const parsed = parseCommitSubject(subject);
  return {
    sha,
    shortSha,
    subject,
    date,
    type: parsed.type,
    scope: parsed.scope,
    description: parsed.description,
    category: parsed.type ? CATEGORY_MAP[parsed.type] ?? FALLBACK_CATEGORY : FALLBACK_CATEGORY
  };
}

/**
 * 解析 commit subject:`<type>(<scope>): <description>`
 * 兼容:
 *   - `feat: 加了 A`        → type=feat, scope=null, description=加了 A
 *   - `feat(api): 加了 A`   → type=feat, scope=api, description=加了 A
 *   - `merge branch ...`    → type=null, scope=null, description=merge branch ...
 */
export function parseCommitSubject(subject: string): { type: string | null; scope: string | null; description: string } {
  // 匹配 type(scope)?: desc;type 是字母+数字+下划线+连字符的组合
  const m = subject.match(/^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return { type: null, scope: null, description: subject };
  const type = m[1] ?? null;
  const scope = m[2] ?? null;
  const bang = m[3] ?? "";
  const desc = m[4] ?? subject;
  return {
    type: type ? type.toLowerCase() : null,
    scope,
    description: bang + desc
  };
}

/** 取最近的 release tag(形如 v1.2.3 / v0.7.0-rc1);用于 "since last release" */
export function getLastReleaseTag(opts: { cwd?: string } = {}): string | null {
  try {
    const out = execFileSync(
      "git",
      ["tag", "--sort=-creatordate", "--list", "v*"],
      { cwd: opts.cwd ?? process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const first = out.split("\n").find((l) => l.trim());
    return first?.trim() || null;
  } catch {
    return null;
  }
}

/** 取当前 HEAD 的完整 SHA(用于 --to 缺省) */
export function getHeadSha(opts: { cwd?: string } = {}): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

/**
 * 把任意 git 引用解析为完整 commit SHA
 *
 * 防御层:从外部输入(ref API 用户的 from/to,或 CLI 脚本的 --from/--to)的字符串
 * 必须先走这里,不能再直接拼到 `git log`/`git rev-list` 的 argv 里。
 * 否则恶意输入可以:
 *   - `HEAD:scripts/release/generate.ts` → git 解析成 tree ref 读仓库文件
 *   - `--output=/etc/passwd` → 如果没有 --end-of-options 隔离,被当作 option
 *   - 各种 `^` `~` `{}` ref 语法被 git 接受,可能造成意外行为
 *
 * 实现: `git rev-parse --verify --end-of-options <ref>^{commit}`:
 *   - --verify: 拒绝不存在 / 模糊的 ref,exit code != 0
 *   - --end-of-options: 后面所有 arg 都当 ref(不当作 git 的 option)
 *   - ^{commit}: 强制 ref 解析为 commit;tree/blob/不存在的报错
 *
 * 返回: 完整 40 字符 commit SHA (调用方拿这个去拼 range,绝对安全)
 * 抛错: ref 无效时 throw new Error(由调用方决定如何转 API 错误)
 */
export function resolveGitRef(ref: string, opts: { cwd?: string } = {}): string {
  // 先做白名单:长度 + 字符,挡住空字符串 / 含控制字符 / 含空格的输入
  // 真实 ref 名允许字母数字 + . + _ + - + /,长度 1-200 (跟 git 自身一致)
  // SHA 是 7-40 位 hex;tag 是 vX.Y.Z 之类
  if (!/^[\w./-]{1,200}$/.test(ref)) {
    throw new Error(`git ref 含非法字符: ${ref}`);
  }
  try {
    const out = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      {
        cwd: opts.cwd ?? process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    return out.trim();
  } catch (e) {
    // git 失败时(stderr 通常是 "fatal: ...") 直接抛,让调用方收
    throw new Error(`无法解析 git ref "${ref}": ${(e as { stderr?: string }).stderr ?? (e as Error).message}`);
  }
}

/** 取 package.json 的 version 字段 */
export function readPackageVersion(opts: { cwd?: string } = {}): string {
  const cwd = opts.cwd ?? process.cwd();
  const pkgPath = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`package.json 在 ${pkgPath} 没有 version 字段`);
  return pkg.version;
}
