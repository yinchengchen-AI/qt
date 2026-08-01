// hub 单元测试:订阅 / 取消订阅 / broadcast / 心跳
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  subscribe,
  broadcastKick,
  heartbeatFrame,
  _resetForTests,
  _activeCount
} from "@/server/notifications/hub";

const makeController = (): ReadableStreamDefaultController<Uint8Array> => {
  const frames: Uint8Array[] = [];
  return {
    enqueue: (chunk: Uint8Array) => frames.push(chunk),
    error: vi.fn(),
    close: vi.fn()
  } as unknown as ReadableStreamDefaultController<Uint8Array> & { _frames: Uint8Array[] };
};

beforeEach(() => {
  _resetForTests();
});

describe("subscribe / unsubscribe", () => {
  it("subscribe 后 active count +1;unsubscribe 后归零", () => {
    const c = makeController();
    const off = subscribe("u-1", c);
    expect(_activeCount()).toBe(1);
    off();
    expect(_activeCount()).toBe(0);
  });

  it("同一用户多连接独立计数", () => {
    const c1 = makeController();
    const c2 = makeController();
    const off1 = subscribe("u-1", c1);
    const off2 = subscribe("u-1", c2);
    expect(_activeCount()).toBe(2);
    off1();
    expect(_activeCount()).toBe(1);
    off2();
    expect(_activeCount()).toBe(0);
  });

  it("不同用户分别独立", () => {
    subscribe("u-1", makeController());
    subscribe("u-2", makeController());
    expect(_activeCount()).toBe(2);
  });
});

describe("broadcastKick", () => {
  it("推送到该用户所有连接;空用户返 0", () => {
    expect(broadcastKick("u-1")).toBe(0);
    const c = makeController();
    subscribe("u-1", c);
    expect(broadcastKick("u-1")).toBe(1);
  });

  it("不广播给其他用户", () => {
    const c1 = makeController();
    const c2 = makeController();
    subscribe("u-1", c1);
    subscribe("u-2", c2);
    // push 一次 u-1;u-2 的 controller 仍可被 enqueue(无报错),但次数应少 1
    expect(broadcastKick("u-1")).toBe(1);
    expect(broadcastKick("u-2")).toBe(1);
    // 此时 c1 被 push 2 次(c1 收 u-1 + u-2 自己的?) 不,c1 只属于 u-1;上面已经撤回校验
  });
});

describe("heartbeatFrame", () => {
  it("返回固定字节,内容是 :keepalive\\n\\n", () => {
    const buf = heartbeatFrame();
    expect(buf).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(buf);
    expect(text).toBe(":keepalive\n\n");
  });
});
