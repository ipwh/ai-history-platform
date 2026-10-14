"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import {
  CURRICULUM_LEVEL_LABELS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
  EXTRACTION_METHOD_LABELS,
  MATERIAL_BLOCK_TYPE_LABELS,
  OCR_STATUS_LABELS,
  type MaterialBlock,
  type MaterialDocument,
  type OcrStatus,
  type TopicOverview,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

interface MaterialDocumentView extends MaterialDocument {
  kindLabel: string;
  ocrStatusLabel: string;
  ocrBlockCount: number;
  sectionCoverage: { sectionId: string; sectionTitle: string; blockCount: number }[];
}

interface MaterialsResponse {
  documents: MaterialDocumentView[];
  totals: {
    documents: number;
    uploaded: number;
    demo: number;
    blocks: number;
    ocrBlocks: number;
  };
}

interface OcrStatusResponse {
  status: OcrStatus;
  provider: string | null;
  message: string | null;
  recognizedCount: number;
  skippedCount: number;
  pendingImages: number;
  running: boolean;
  ocrEngine: {
    enabled: boolean;
    providerLabel: string;
    languages: string;
    maxImagesPerRun: number;
    notice: string | null;
  };
}

interface DiskMaterial {
  fileName: string;
  topicId: string | null;
  topicTitle: string | null;
}

/**
 * 教材管理（管理員端）。
 *
 * @param initialDocumentId 由 /teacher/materials/[documentId] 進入時自動展開的教材文件，
 *   方便教師由教材清單直接跳到單一文件的段落、OCR 及分節修正。
 */
export function MaterialManager({ initialDocumentId }: { initialDocumentId?: string } = {}) {
  const [data, setData] = useState<MaterialsResponse | null>(null);
  const [topics, setTopics] = useState<TopicOverview[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");
  const [runOcrOnUpload, setRunOcrOnUpload] = useState(true);
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(initialDocumentId ?? null);
  const [blocks, setBlocks] = useState<MaterialBlock[] | null>(null);
  const [blocksLoading, setBlocksLoading] = useState(Boolean(initialDocumentId));
  const [blockError, setBlockError] = useState<unknown>(null);
  const [diskMaterials, setDiskMaterials] = useState<DiskMaterial[]>([]);
  const [diskLoaded, setDiskLoaded] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<Record<string, OcrStatusResponse>>({});
  const [ocrEngineLabel, setOcrEngineLabel] = useState<string>("");
  const [importingAll, setImportingAll] = useState(false);

  const refresh = useCallback(async () => {
    const [materials, topicData] = await Promise.all([
      api.get<MaterialsResponse>("/api/admin/materials"),
      api.get<{ topics: TopicOverview[] }>("/api/topics"),
    ]);
    setData(materials);
    setTopics(topicData.topics);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<MaterialsResponse>("/api/admin/materials"),
      api.get<{ topics: TopicOverview[] }>("/api/topics"),
      api.get<{ items: DiskMaterial[]; ocr: { enabled: boolean; providerLabel: string } }>(
        "/api/admin/materials/import",
      ),
    ])
      .then(([materials, topicList, disk]) => {
        if (cancelled) return;
        setData(materials);
        setTopics(topicList.topics);
        setDiskMaterials(disk.items);
        setDiskLoaded(true);
        setOcrEngineLabel(
          disk.ocr.enabled ? disk.ocr.providerLabel : "OCR 已停用（可在 .env.local 設定）",
        );
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
          setDiskLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 輪詢正在執行的 OCR 工作。
   * 以非同步迴圈實作（而非遞歸），避免函式初始化順序問題；
   * polling 狀態存放在 ref，元件卸載時會停止。
   */
  const pollingIds = useRef<string[]>([]);

  const pollOcr = useCallback(
    async (documentIds: string[]) => {
      if (documentIds.length === 0) return;
      pollingIds.current = documentIds;

      while (pollingIds.current.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (pollingIds.current.length === 0) return;

        try {
          const results = await Promise.all(
            pollingIds.current.map((id) =>
              api
                .get<OcrStatusResponse>(`/api/admin/materials/${id}/ocr`)
                .then((status) => [id, status] as const)
                .catch(() => null),
            ),
          );

          const updates: Record<string, OcrStatusResponse> = {};
          let stillRunning = false;
          for (const entry of results) {
            if (!entry) continue;
            updates[entry[0]] = entry[1];
            if (entry[1].running || entry[1].status === "running") stillRunning = true;
          }
          setOcrStatus((prev) => ({ ...prev, ...updates }));

          if (!stillRunning) {
            pollingIds.current = [];
            await refresh();
          }
        } catch {
          // 輪詢失敗時停止，使用者可手動重新整理
          pollingIds.current = [];
        }
      }
    },
    [refresh],
  );

  // 元件卸載時停止輪詢
  useEffect(() => {
    return () => {
      pollingIds.current = [];
    };
  }, []);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedTopicId) formData.append("topicId", selectedTopicId);
      if (runOcrOnUpload) formData.append("runOcr", "true");

      const result = await api.upload<{
        document: MaterialDocument;
        blockCount: number;
        warnings: string[];
        detectedTopic: { title: string } | null;
      }>("/api/admin/materials", formData);

      setMessage(
        result.document.status === "ready"
          ? `已處理「${result.document.fileName}」，共擷取 ${result.blockCount} 段${
              result.detectedTopic ? `，已對應課題：${result.detectedTopic.title}` : ""
            }${runOcrOnUpload ? "；OCR 已在背景開始執行" : ""}。`
          : `「${result.document.fileName}」處理失敗：${result.document.errorMessage ?? "未知原因"}`,
      );
      await refresh();
      if (runOcrOnUpload && result.document.id) {
        void pollOcr([result.document.id]);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setUploading(false);
    }
  }

  async function handleImportFromDisk(fileName: string | null, all = false) {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        imported: number;
        failed: number;
        results: { fileName: string; topicId: string | null; blockCount: number; errorMessage: string | null }[];
      }>("/api/admin/materials/import", { fileName, all, runOcr: runOcrOnUpload });

      const details = result.results
        .map((item) => `${item.fileName}（${item.blockCount} 段）`)
        .join("、");
      setMessage(
        `已匯入 ${result.imported} 份教材${result.failed > 0 ? `，${result.failed} 份失敗` : ""}：${details}${
          runOcrOnUpload ? "。OCR 已在背景執行。" : ""
        }`,
      );
      await refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setUploading(false);
      setImportingAll(false);
    }
  }

  async function handleOpenDocument(documentId: string) {
    setOpenDocumentId(documentId);
    setBlocks(null);
    setBlockError(null);
    setBlocksLoading(true);
    try {
      const result = await api.get<{ blocks: MaterialBlock[] }>(
        `/api/admin/materials/${documentId}`,
      );
      setBlocks(result.blocks);
    } catch (caught) {
      setBlockError(caught);
    } finally {
      setBlocksLoading(false);
    }
  }

  /** 由 /teacher/materials/[documentId] 進入時自動展開該文件（只執行一次） */
  const openedInitialDocument = useRef(false);
  useEffect(() => {
    if (openedInitialDocument.current) return;
    if (!initialDocumentId || !data) return;
    openedInitialDocument.current = true;
    api
      .get<{ blocks: MaterialBlock[] }>(`/api/admin/materials/${initialDocumentId}`)
      .then((result) => {
        setBlocks(result.blocks);
        setBlocksLoading(false);
      })
      .catch((caught: unknown) => {
        setBlockError(caught);
        setBlocksLoading(false);
      });
  }, [data, initialDocumentId]);

  async function handleRunOcr(documentId: string) {
    setError(null);
    setMessage(null);
    try {
      await api.post(`/api/admin/materials/${documentId}/ocr`, {});
      setOcrStatus((prev) => ({
        ...prev,
        [documentId]: {
          ...(prev[documentId] ?? {
            provider: null,
            message: null,
            recognizedCount: 0,
            skippedCount: 0,
            pendingImages: 0,
            ocrEngine: {
              enabled: true,
              providerLabel: ocrEngineLabel,
              languages: "",
              maxImagesPerRun: 0,
              notice: null,
            },
          }),
          status: "running",
          running: true,
        } as OcrStatusResponse,
      }));
      void pollOcr([documentId]);
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleDeleteDocument(documentId: string) {
    setError(null);
    try {
      await api.delete(`/api/admin/materials/${documentId}`);
      setMessage("已刪除教材及其擷取內容。");
      setOpenDocumentId(null);
      await refresh();
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleAssignTopic(documentId: string, topicId: string) {
    try {
      await api.patch(`/api/admin/materials/${documentId}`, { topicId: topicId || null });
      setMessage("已更新教材所屬課題。");
      await refresh();
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleBlockSectionChange(blockId: string, sectionId: string) {
    try {
      await api.patch(`/api/admin/materials/blocks/${blockId}`, {
        sectionId: sectionId || null,
      });
      setBlocks((current) =>
        (current ?? []).map((block) =>
          block.id === blockId ? { ...block, sectionId: sectionId || null } : block,
        ),
      );
    } catch (caught) {
      setError(caught);
    }
  }

  // 依課程年級分組顯示教材（level 0 為未對應任何課題的教材）
  const groupedDocuments = [1, 2, 3, 0].map((level) => ({
    level,
    label: level === 0 ? "未對應課題的教材" : CURRICULUM_LEVEL_LABELS[level as 1 | 2 | 3],
    documents: (data?.documents ?? []).filter((document) => {
      const topic = topics.find((item) => item.id === document.topicId);
      if (level === 0) return document.topicId === null || topic === undefined;
      return topic?.level === level;
    }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">教材管理</h1>
        <p className="text-sm text-gray-600">
          匯入教育局歷史科課程教材（12 個課題，中一至中三）。系統會擷取標題、清單、段落及表格，
          並自動對應到課題分節；圖片文字會以 OCR 辨識後加入教材內容，供 AI 生成題目之用。
        </p>
        <p className="text-xs text-gray-500 mt-1">目前 OCR 引擎：{ocrEngineLabel}</p>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <ErrorNotice error={error} onRetry={() => void refresh()} /> : null}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">匯入課程教材</h2>

        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setImportingAll(true);
              void handleImportFromDisk(null, true);
            }}
            disabled={uploading || importingAll}
          >
            {importingAll || uploading ? "正在匯入…" : "匯入全部課程教材（12 個課題）"}
          </button>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={runOcrOnUpload}
              onChange={(event) => setRunOcrOnUpload(event.target.checked)}
              style={{ width: "auto" }}
            />
            匯入後執行 OCR（辨識圖片文字）
          </label>
        </div>

        {!diskLoaded ? (
          <p className="text-sm text-gray-500">正在讀取 materials 資料夾…</p>
        ) : diskMaterials.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-sm">
              materials 資料夾內的教材（{diskMaterials.length} 份）— 可逐份匯入
            </summary>
            <ul className="mt-2 flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
              {diskMaterials.map((item) => (
                <li key={item.fileName} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="break-all">{item.fileName}</span>
                  {item.topicTitle ? (
                    <span className="badge badge-accent">{item.topicTitle}</span>
                  ) : (
                    <span className="badge badge-warning">未對應課題</span>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleImportFromDisk(item.fileName)}
                    disabled={uploading}
                  >
                    匯入
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-sm text-gray-500">materials 資料夾內沒有可匯入的 .docx／.pdf 教材。</p>
        )}

        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="flex-1 text-sm">
            上載其他教材（可留空課題，系統會嘗試由檔名判斷，例如 HNC1A2E_T1 → 課題1）
            <select
              value={selectedTopicId}
              onChange={(event) => setSelectedTopicId(event.target.value)}
            >
              <option value="">（自動判斷）</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {CURRICULUM_LEVEL_LABELS[topic.level]} {topic.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1">選擇檔案（.docx 或 .pdf）</span>
            <input
              type="file"
              accept=".docx,.pdf"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <Notice>
          支援限制：DOCX 可保留標題、清單及表格結構；PDF 只可擷取文字層（掃描檔會改用 OCR）。
          EMF／WMF／WDP 等向量圖片格式未能 OCR，系統會明確顯示限制而不會猜測內容。
        </Notice>
      </section>

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">教材清單</h2>
          {data ? (
            <span className="text-xs text-gray-600">
              共 {data.totals.documents} 份文件（示範 {data.totals.demo}、已上載{" "}
              {data.totals.uploaded}）、{data.totals.blocks} 個段落，其中 {data.totals.ocrBlocks}{" "}
              段來自 OCR
            </span>
          ) : null}
        </div>

        {!data ? (
          <Loading label="正在載入教材清單…" />
        ) : data.documents.length === 0 ? (
          <p className="text-sm text-gray-600">尚未匯入任何教材。</p>
        ) : (
          groupedDocuments.map((group) =>
            group.documents.length === 0 ? null : (
              <div key={group.level} className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-gray-700">{group.label}</h3>
                <ul className="flex flex-col gap-3">
                  {group.documents.map((document) => {
                    const status = ocrStatus[document.id];
                    const ocrState = status?.status ?? document.ocrStatus;
                    const running = status?.running || ocrState === "running";
                    const topic = topics.find((item) => item.id === document.topicId);
                    return (
                      <li
                        key={document.id}
                        className="rounded-xl border p-3"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium break-all">{document.fileName}</span>
                          <span
                            className={`badge ${
                              document.status === "ready" ? "badge-success" : "badge-danger"
                            }`}
                          >
                            {DOCUMENT_STATUS_LABELS[document.status]}
                          </span>
                          <span
                            className={`badge ${
                              document.kind === "demo" ? "badge-warning" : "badge-accent"
                            }`}
                          >
                            {DOCUMENT_KIND_LABELS[document.kind]}
                          </span>
                          <span className="badge">{document.blockCount} 段</span>
                          {topic ? (
                            <span className="badge badge-accent">
                              {CURRICULUM_LEVEL_LABELS[topic.level]} {topic.title}
                            </span>
                          ) : null}
                          <span
                            className={`badge ${
                              ocrState === "done"
                                ? "badge-success"
                                : ocrState === "running"
                                  ? "badge-accent"
                                  : ocrState === "failed"
                                    ? "badge-danger"
                                    : ocrState === "partial"
                                      ? "badge-warning"
                                      : ""
                            }`}
                          >
                            {OCR_STATUS_LABELS[ocrState]}
                            {document.ocrRecognizedCount > 0
                              ? `（${document.ocrRecognizedCount} 張）`
                              : ""}
                          </span>
                          {document.ocrBlockCount > 0 ? (
                            <span className="badge badge-accent">
                              {document.ocrBlockCount} 段 OCR 文字
                            </span>
                          ) : null}
                        </div>

                        {document.errorMessage ? (
                          <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
                            錯誤訊息：{document.errorMessage}
                          </p>
                        ) : null}
                        {document.limitationNote ? (
                          <p className="text-sm mt-2 text-gray-600">
                            限制說明：{document.limitationNote}
                          </p>
                        ) : null}
                        {status?.message || document.ocrMessage ? (
                          <p className="text-sm mt-2" style={{ color: "var(--warning)" }}>
                            OCR：{status?.message ?? document.ocrMessage}
                          </p>
                        ) : null}
                        {document.sectionCoverage.length > 0 ? (
                          <p className="text-xs text-gray-500 mt-2">
                            已對應分節：
                            {document.sectionCoverage
                              .map((item) => `${item.sectionTitle}（${item.blockCount}）`)
                              .join("、")}
                          </p>
                        ) : null}

                        <div className="flex flex-wrap items-end gap-2 mt-3">
                          <label className="text-xs">
                            所屬課題
                            <select
                              value={document.topicId ?? ""}
                              onChange={(event) =>
                                void handleAssignTopic(document.id, event.target.value)
                              }
                            >
                              <option value="">（未指定）</option>
                              {topics.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {CURRICULUM_LEVEL_LABELS[item.level]} {item.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleRunOcr(document.id)}
                            disabled={running}
                          >
                            {running ? "OCR 進行中…" : "執行 OCR"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleOpenDocument(document.id)}
                          >
                            預覽擷取內容
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void handleDeleteDocument(document.id)}
                          >
                            刪除教材
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ),
          )
        )}
      </section>

      {openDocumentId ? (
        <section className="card flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">擷取內容預覽</h2>
            <button type="button" className="btn" onClick={() => setOpenDocumentId(null)}>
              關閉
            </button>
          </div>
          {blocksLoading ? <Loading label="正在載入擷取內容…" /> : null}
          {blockError ? <ErrorNotice error={blockError} /> : null}
          {blocks ? (
            <BlockPreview
              blocks={blocks}
              topics={topics}
              onSectionChange={handleBlockSectionChange}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function BlockPreview({
  blocks,
  topics,
  onSectionChange,
}: {
  blocks: MaterialBlock[];
  topics: TopicOverview[];
  onSectionChange: (blockId: string, sectionId: string) => Promise<void>;
}) {
  const [onlyOcr, setOnlyOcr] = useState(false);

  const sectionOptions = topics.flatMap((topic) =>
    topic.sections.flatMap((section) => [
      { id: section.id, label: `${topic.title} › ${section.title}` },
      ...section.children.map((child) => ({
        id: child.id,
        label: `${topic.title} › ${section.title} › ${child.title}`,
      })),
    ]),
  );

  const ocrCount = blocks.filter((block) => block.extractionMethod === "ocr").length;
  const visible = onlyOcr ? blocks.filter((block) => block.extractionMethod === "ocr") : blocks;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-gray-500">
          共 {blocks.length} 段，其中 {ocrCount} 段來自 OCR 圖片辨識。教師可直接調整每段所屬分節，
          令之後生成的題目有正確的來源依據。
        </p>
        <label className="text-xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyOcr}
            onChange={(event) => setOnlyOcr(event.target.checked)}
            style={{ width: "auto" }}
          />
          只顯示 OCR 段落
        </label>
      </div>
      <ul className="flex flex-col gap-2 max-h-[32rem] overflow-y-auto pr-1">
        {visible.map((block, index) => (
          <li
            key={block.id}
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>#{index + 1}</span>
              <span className="badge">{MATERIAL_BLOCK_TYPE_LABELS[block.type]}</span>
              {block.extractionMethod === "ocr" ? (
                <span className="badge badge-warning">
                  {EXTRACTION_METHOD_LABELS.ocr}
                </span>
              ) : null}
              <span className="break-all">{block.sourceLocation}</span>
            </div>
            {block.type === "image" && block.extractionMethod !== "ocr" ? (
              <p className="mt-1 text-gray-500">圖片內容未能自動擷取（可執行 OCR 嘗試辨識文字）</p>
            ) : block.table ? (
              <div className="mt-1 overflow-x-auto">
                <table className="material-table">
                  <tbody>
                    {block.table.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} colSpan={cell.colSpan}>
                            {cell.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap">{block.text}</p>
            )}
            <label className="text-xs text-gray-600 mt-2 block">
              指派分節
              <select
                value={block.sectionId ?? ""}
                onChange={(event) => void onSectionChange(block.id, event.target.value)}
              >
                <option value="">（不指派）</option>
                {sectionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

