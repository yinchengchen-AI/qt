// AppRelease zod validator 单元测试
import { describe, it, expect } from "vitest";
import { appReleaseCreateSchema, appReleaseUpdateSchema } from "@/lib/validators/app-release";

describe("appReleaseCreateSchema", () => {
  it("必填字段缺失 → 抛错", () => {
    expect(() => appReleaseCreateSchema.parse({})).toThrow();
    expect(() => appReleaseCreateSchema.parse({ version: "v1" })).toThrow();
  });

  it("正常字段通过 + important 默认 false", () => {
    const v = appReleaseCreateSchema.parse({
      version: "v0.7.0",
      title: "更新日志功能上线",
      summary: "现在登录后会弹出更新说明",
      content: "本版本主要引入了 AppRelease 模型 + 弹窗"
    });
    expect(v.important).toBe(false);
    expect(v.version).toBe("v0.7.0");
  });

  it("version 必须含数字 (regex)", () => {
    expect(() =>
      appReleaseCreateSchema.parse({ version: "vNext", title: "测试标题", summary: "测试概要", content: "测试内容" })
    ).toThrow(/版本号需包含数字/);
  });

  it("字段超长被拒", () => {
    expect(() =>
      appReleaseCreateSchema.parse({
        version: "v0.7.0",
        title: "x".repeat(201),
        summary: "x",
        content: "x"
      })
    ).toThrow();
  });
});

describe("M-1 version 归一化", () => {
  it("无 v 前缀 → 自动加 v", () => {
    const v = appReleaseCreateSchema.parse({
      version: "0.7.1", title: "测试标题", summary: "测试概要", content: "测试内容"
    });
    expect(v.version).toBe("v0.7.1");
  });

  it("已有 v 前缀 → 不动", () => {
    const v = appReleaseCreateSchema.parse({
      version: "v0.7.0", title: "测试标题", summary: "测试概要", content: "测试内容"
    });
    expect(v.version).toBe("v0.7.0");
  });

  it("V (大写) 不被识别为前缀,会被加上 v → vV0.7.0 (这是边缘 case 但保持确定行为)", () => {
    const v = appReleaseCreateSchema.parse({
      version: "V0.7.0", title: "测试标题", summary: "测试概要", content: "测试内容"
    });
    expect(v.version).toBe("vV0.7.0");
  });
});

describe("appReleaseUpdateSchema", () => {
  it("全 optional:空对象 OK", () => {
    expect(() => appReleaseUpdateSchema.parse({})).not.toThrow();
  });

  it("可单独更新 important", () => {
    const v = appReleaseUpdateSchema.parse({ important: true });
    expect(v.important).toBe(true);
  });
});
