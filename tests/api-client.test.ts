import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
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
