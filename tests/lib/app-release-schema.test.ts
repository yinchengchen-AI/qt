// AppRelease zod validator 单元测试
// 校验规则:version 必须以 v 开头并至少有一个数字;title 2-200;summary 1-500;
// content 1-10000;important 默认 false。
import { describe, it, expect } from "vitest";
import { appReleaseCreateSchema, appReleaseUpdateSchema } from "@/lib/validators/app-release";

describe("appReleaseCreateSchema", () => {
  it("必填字段缺失 -> 抛错", () => {
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

  it("version 必须以 v 开头并包含数字 (regex)", () => {
    expect(() =>
      appReleaseCreateSchema.parse({ version: "0.7.0", title: "测试标题", summary: "测试概要", content: "测试内容" })
    ).toThrow(/版本号必须以 v/);
    expect(() =>
      appReleaseCreateSchema.parse({ version: "vNext", title: "测试标题", summary: "测试概要", content: "测试内容" })
    ).toThrow(/版本号必须以 v/);
    expect(() =>
      appReleaseCreateSchema.parse({ version: "v1", title: "测试标题", summary: "测试概要", content: "测试内容" })
    ).not.toThrow();
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

describe("version 格式", () => {
  it("v 开头 + 数字 -> 原样通过", () => {
    const v = appReleaseCreateSchema.parse({
      version: "v0.7.1", title: "测试标题", summary: "测试概要", content: "测试内容"
    });
    expect(v.version).toBe("v0.7.1");
  });

  it("已有 v 开头 -> 不再二次加 v (避免历史 vV0.7.0 bug)", () => {
    const v = appReleaseCreateSchema.parse({
      version: "v0.7.0", title: "测试标题", summary: "测试概要", content: "测试内容"
    });
    expect(v.version).toBe("v0.7.0");
  });

  it("缺 v 前缀 -> 被拒 (不自动加)", () => {
    expect(() =>
      appReleaseCreateSchema.parse({
        version: "0.7.0", title: "测试标题", summary: "测试概要", content: "测试内容"
      })
    ).toThrow();
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
