import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("dingtalk sdk", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "test_key";
    process.env.DINGTALK_APP_SECRET = "test_secret";
    vi.resetModules();
  });

  it("getQrCode calls upstream to get qrcodeUrl/tmpCode/expiresIn", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc1", expiresIn: 180, qrcodeUrl: "https://oapi/qr?code=tc1" }) });

    const { getQrCode } = await import("@/lib/dingtalk");
    const r = await getQrCode();
    expect(r.qrcodeUrl).toBe("https://oapi/qr?code=tc1");
    expect(r.tmpCode).toBe("tc1");
    expect(r.expiresIn).toBe(180);
  });

  it("getQrCode upstream failure throws DINGTALK_UPSTREAM_ERROR ApiError", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { getQrCode } = await import("@/lib/dingtalk");
    await expect(getQrCode()).rejects.toMatchObject({
      errorCode: "DINGTALK_UPSTREAM_ERROR",
      status: 502,
    });
  });

  it("access_token is cached across calls", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc1", expiresIn: 180, qrcodeUrl: "u" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc2", expiresIn: 180, qrcodeUrl: "u" }) });
    const { getQrCode } = await import("@/lib/dingtalk");
    await getQrCode();
    await getQrCode();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("gettoken"));
    expect(tokenCalls.length).toBe(1);
  });

  it("pollQrCode pending returns PENDING", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "PENDING" }) });
    const { pollQrCode } = await import("@/lib/dingtalk");
    const r = await pollQrCode("tc1");
    expect(r.status).toBe("PENDING");
  });

  it("pollQrCode confirmed returns CONFIRMED + authCode", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "CONFIRMED", authCode: "ac1" }) });
    const { pollQrCode } = await import("@/lib/dingtalk");
    const r = await pollQrCode("tc1");
    expect(r.status).toBe("CONFIRMED");
    if (r.status === "CONFIRMED") {
      expect(r.authCode).toBe("ac1");
    }
  });

  it("getUserInfoByAuthCode returns unionid/mobile/nick", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { userid: "u_abc" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { mobile: "13800000000", nick: "test" } }) });
    const { getUserInfoByAuthCode } = await import("@/lib/dingtalk");
    const r = await getUserInfoByAuthCode("ac1");
    expect(r.mobile).toBe("13800000000");
    expect(r.unionid).toBe("u_abc");
  });
});