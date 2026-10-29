import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";
import { ApiError, describeApiFailure } from "@/lib/api-errors";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("錯誤分類（學生可見的說明）", () => {
  it("登入／權限問題不建議重試，並提示重新登入", () => {
    const unauthorized = describeApiFailure(new ApiError("請先登入", 401));
    expect(unauthorized.kind).toBe("auth");
    expect(unauthorized.retryable).toBe(false);
    expect(unauthorized.hint).toContain("重新登入");

    const forbidden = describeApiFailure(new ApiError("不能讀取其他學習者的記錄", 403));
    expect(forbidden.kind).toBe("forbidden");
    expect(forbidden.retryable).toBe(false);
    expect(forbidden.message).toBe("不能讀取其他學習者的記錄");
  });

  it("伺服器錯誤建議重試，並保留伺服器提供的細節", () => {
    const failure = describeApiFailure(new ApiError("資料庫忙碌", 503, ["請稍後再試"]));
    expect(failure.kind).toBe("server");
    expect(failure.retryable).toBe(true);
    expect(failure.details).toEqual(["請稍後再試"]);
    expect(failure.hint).not.toBeNull();
  });

  it("找不到資料、版本衝突、限流各自有獨立類別", () => {
    expect(describeApiFailure(new ApiError("找不到這次練習記錄", 404)).kind).toBe("not-found");
    expect(describeApiFailure(new ApiError("已被修改", 409)).kind).toBe("conflict");
    expect(describeApiFailure(new ApiError("太頻繁", 429)).kind).toBe("rate-limited");
    expect(describeApiFailure(new ApiError("參數不正確", 400)).kind).toBe("client");
  });

  it("回應格式不正確（HTTP 成功但非 JSON）與逾時有獨立類別", () => {
    const format = describeApiFailure(
      new ApiError("伺服器回應格式不正確（HTTP 200），請重試。", 200, [], "format"),
    );
    expect(format.kind).toBe("format");
    expect(format.retryable).toBe(true);

    const timeout = describeApiFailure(
      new ApiError("伺服器在 20 秒內沒有回應，請重試。", 0, [], "timeout"),
    );
    expect(timeout.kind).toBe("timeout");
    expect(timeout.message).toContain("20 秒");
  });

  it("空題目清單是獨立類別，不會被當成「沒有題目」以外的沉默失敗", () => {
    const empty = describeApiFailure(
      new ApiError("伺服器回傳的題目清單是空的，因此未能顯示題目。", 200, [], "empty"),
    );
    expect(empty.kind).toBe("empty");
    expect(empty.title).toContain("沒有可顯示的題目");
  });

  it("網絡失敗（fetch 拋出 TypeError）判為網絡問題，附上可行動的提示", () => {
    const failure = describeApiFailure(new TypeError("Failed to fetch"));
    expect(failure.kind).toBe("network");
    expect(failure.retryable).toBe(true);
    expect(failure.hint).toContain("Wi-Fi");
  });

  it("Safari 的 `Load failed`（即使不是 TypeError 實例）同樣判為網絡問題", () => {
    // WebKit 對被中途切斷的連線只給英文訊息；若只以 `instanceof TypeError` 判斷，
    // 就會掉進「未知」分支，把英文原文直接顯示給學生（2026-10-28 正式環境實際情況）。
    const failure = describeApiFailure(new Error("Load failed"));
    expect(failure.kind).toBe("network");
    expect(failure.title).not.toContain("發生問題");
    expect(failure.message).not.toContain("Load failed");
  });

  it("中止／逾時例外判為逾時", () => {
    const aborted = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    expect(describeApiFailure(aborted).kind).toBe("timeout");
  });

  it("未知錯誤保留原始訊息，不會被靜默吞掉", () => {
    const failure = describeApiFailure(new Error("自訂錯誤訊息"));
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe("自訂錯誤訊息");
  });
});

describe("載入時限", () => {
  it("超過時限時拋出 kind=timeout 的 ApiError，而不是永遠等待", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }),
    );

    await expect(api.get("/api/practice/session-1", { timeoutMs: 20 })).rejects.toMatchObject({
      name: "ApiError",
      kind: "timeout",
    });
  });

  it("沒有指定 timeoutMs 時不會自行加設時限（提交答案可能較慢）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(api.post("/api/practice/session-1/answers", { answer: "甲" })).resolves.toEqual({
      ok: true,
    });
  });
});
