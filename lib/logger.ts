// 轻量 logger:debug/info/warn/error,带 module 前缀
// - 调试期(NODE_ENV=development)输出所有级别
// - 生产只输出 warn / error,避免日志噪声
// 不依赖任何外部包,直接在 server/jobs/lib 等任意位置用

type Level = "debug" | "info" | "warn" | "error";

const isDev = process.env.NODE_ENV !== "production";

function emit(level: Level, args: unknown[]): void {
  if (!isDev && (level === "debug" || level === "info")) return;
  const stamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${stamp}] ${tag}`, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args)
};
