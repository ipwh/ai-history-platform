import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("API response parsing", () => {
  it("shows a readable error when the server returns a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>upstream error</html>", { status: 502 })),
    );

    await expect(api.get("/api/health")).rejects.toMatchObject({
      name: "ApiError",
      message: "伺服器回應格式不正確（HTTP 502），請重試。",
      status: 502,
    });
  });
});

describe("冷啟動中止（min-instances=0）", () => {
  const edgeAbort = () =>
    new Response("The request was aborted because there was no available instance.", {
      status: 429,
    });

  it("先自動重試，執行個體接手後成功", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(edgeAbort())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.get<{ ok: boolean }>("/api/health");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("重試後仍然失敗時，訊息是可行動的中文而非「格式不正確」", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => edgeAbort());
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.post("/api/practice", { learnerId: "x" });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "ApiError",
      kind: "unavailable",
      status: 429,
    });
    await vi.runAllTimersAsync();
    await assertion;
    // 首次 + 兩次重試
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
