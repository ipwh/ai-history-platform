import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleProvider } from "@/server/llm/openai-provider";
import type { QuestionGenerationInput } from "@/server/llm/provider";

const input: QuestionGenerationInput = {
  topicTitle: "近代歐洲的興起",
  sectionTitle: "文藝復興 › 主要特點",
  questionTypes: ["mc"],
  difficulty: "basic",
  count: 1,
  materialUnits: [
    {
      blockId: "block-1",
      sourceLocation: "HNC2A2E_T5_SN_TE.docx 第 1 段",
      text: "文藝復興時期，歐洲人重視人文主義。",
    },
  ],
};

const validQuestion = {
  questionType: "mc",
  difficulty: "basic",
  question: "文藝復興時期，歐洲人重視甚麼思想？",
  options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
  correctAnswerIndex: 0,
  correctAnswer: "人文主義",
  explanation: "教材指出文藝復興重視人文主義。",
  knowledgePoint: "文藝復興的主要特點",
  sourceExcerpt: "文藝復興時期，歐洲人重視人文主義。",
  sourceBlockIds: ["block-1"],
  gradingPoints: [],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI 相容 provider（DeepSeek 參數）", () => {
  it("依 DeepSeek JSON Output 要求傳送參數，並關閉思考模式", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ questions: [validQuestion] }) } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      timeoutMs: 5_000,
      name: "deepseek",
      maxTokens: 8_192,
      thinking: "disabled",
      reasoningEffort: null,
      emptyContentRetries: 1,
    });

    const outcome = await provider.generateQuestions(input);
    expect(outcome.questions).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers).toMatchObject({ authorization: "Bearer sk-test" });

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-flash");
    expect(body.max_tokens).toBe(8_192);
    expect(body.response_format).toEqual({ type: "json_object" });
    // 思考模式關閉時才傳送 temperature；思考模式下此參數不會生效
    expect(body.temperature).toBe(0.6);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();

    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    // JSON Output 要求 prompt 內必須含有「json」字樣
    expect(messages[0].content.toLowerCase()).toContain("json");
  });

  it("思考模式開啟時傳送 thinking 及 reasoning_effort，並省略 temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: JSON.stringify([validQuestion]) } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      timeoutMs: 5_000,
      name: "deepseek",
      maxTokens: null,
      thinking: "enabled",
      reasoningEffort: "high",
    });

    await provider.generateQuestions(input);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<
      string,
      unknown
    >;
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("遇到空白的 JSON 回應會自動重試", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "" } }] }))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: JSON.stringify({ questions: [validQuestion] }) } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      timeoutMs: 5_000,
      name: "deepseek",
      emptyContentRetries: 1,
    });

    const outcome = await provider.generateQuestions(input);
    expect(outcome.questions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("連續空白回應會回報可重試的錯誤", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ choices: [{ message: { content: "  " } }] })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      timeoutMs: 5_000,
      name: "deepseek",
      emptyContentRetries: 1,
    });

    await expect(provider.generateQuestions(input)).rejects.toThrow(/沒有回傳內容/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("API 錯誤會轉成可讀訊息", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Authentication Fails" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-bad",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      timeoutMs: 5_000,
      name: "deepseek",
    });

    await expect(provider.generateQuestions(input)).rejects.toThrow(/Authentication Fails/);
  });
});
