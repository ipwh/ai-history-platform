/**
 * 模擬教師使用平台（真實 HTTP ＋ 真實資料庫，可選真實 LLM 生成）。
 *
 * 覆蓋教師端三個主要部分，並以「實際使用」的組合逐一核對不變量（invariants）：
 *   [A] 學習記錄：全部／按課題／按學習者／按日期查詢，四種格式匯出，
 *       匯出內容必須與所選學習者一致（2026-10-22 用家回報的缺陷）。
 *   [B] 題目管理：清單篩選、手動新增、修改、發布關卡、停用、刪除、生成題目。
 *   [C] 教師審核：回報清單／已處理／略過／重設、暫時下架、重新驗證、覆核紀錄。
 *
 * 用法（需先啟動伺服器，並設定 ADMIN_TOKEN 或未啟用登入的示範模式）：
 *   node scripts/simulate-teacher-usage.mjs --base-url http://127.0.0.1:3000
 *   ADMIN_TOKEN=… node scripts/simulate-teacher-usage.mjs --generate 2
 */
const BASE_URL = arg("--base-url", process.env.SIM_BASE_URL ?? "http://127.0.0.1:3106");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const GENERATE = Number(arg("--generate", "0"));
const OUT = arg("--out", null);

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const anomalies = [];
const info = [];
let checksRun = 0;
let requestsRun = 0;

function anomaly(kind, message, detail) {
  anomalies.push({ kind, message, detail });
}

function check(condition, kind, message, detail) {
  checksRun += 1;
  if (!condition) anomaly(kind, message, detail);
  return Boolean(condition);
}

async function call(method, url, body, options = {}) {
  requestsRun += 1;
  const headers = { ...(options.headers ?? {}) };
  if (ADMIN_TOKEN) headers["x-admin-token"] = ADMIN_TOKEN;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE_URL}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    payload = Buffer.from(await response.arrayBuffer());
  }
  return { status: response.status, payload, headers: response.headers };
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** 匯出的 CSV 逐列取出學習者 ID（第 6 欄），用於核對匯出範圍 */
function csvLearnerIds(text) {
  const rows = text
    .split("\r\n")
    .slice(1)
    .filter((line) => line.length > 0);
  return { rows, learnerIds: new Set(rows.map((line) => line.split(",")[5])) };
}

async function main() {
  console.log(`模擬教師使用：${BASE_URL}${ADMIN_TOKEN ? "（使用 ADMIN_TOKEN）" : "（未提供 ADMIN_TOKEN）"}`);

  const health = await call("GET", "/api/health");
  if (health.status !== 200) {
    console.error(`無法連線（HTTP ${health.status}），請先啟動伺服器。`);
    process.exit(1);
  }
  info.push(`伺服器 LLM provider：${health.payload?.llmProvider}（authEnabled=${health.payload?.authEnabled}）`);

  const topics = (await call("GET", "/api/topics?learnerId=teacher-sim")).payload?.topics ?? [];
  check(topics.length >= 12, "topics", `課題清單只有 ${topics.length} 個`);
  const topic = topics.find((item) => item.published && item.level <= 3) ?? topics[0];

  /* ---------------- [A] 學習記錄 ---------------- */
  console.log("\n[A] 學習記錄（查詢及匯出）");
  const recordsResponse = await call("GET", "/api/teacher/records");
  check(recordsResponse.status === 200, "records", `GET /api/teacher/records 回應 ${recordsResponse.status}`);
  const allRecords = recordsResponse.payload?.records ?? [];
  const learners = (recordsResponse.payload?.learners ?? []).filter((learner) => learner.sessions > 0);
  info.push(`練習記錄 ${allRecords.length} 次、有記錄的學習者 ${learners.length} 位`);
  if (allRecords.length === 0) {
    console.log("  （此資料庫沒有練習記錄，略過部分匯出檢查）");
  }

  const overview = await call("GET", "/api/teacher/overview");
  check(overview.status === 200, "overview", `GET /api/teacher/overview 回應 ${overview.status}`);

  // 按課題
  if (topic) {
    const byTopic = await call("GET", `/api/teacher/records?topicId=${encodeURIComponent(topic.id)}`);
    check(byTopic.status === 200, "records", `按課題查詢回應 ${byTopic.status}`);
    check(
      (byTopic.payload?.records ?? []).every((record) => record.topicId === topic.id),
      "records",
      "按課題查詢時出現其他課題的記錄",
    );
  }

  // 按日期（只取今天之後 → 應為 0 筆，驗證日期篩選真的生效）
  const futureFrom = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const futureRecords = await call("GET", `/api/teacher/records?from=${futureFrom}`);
  check(
    (futureRecords.payload?.records ?? []).length === 0,
    "records",
    `未來的開始日期仍回傳 ${(futureRecords.payload?.records ?? []).length} 筆記錄`,
  );

  // 按學習者 + 匯出（四種格式都必須只包含該學習者）
  for (const learner of learners.slice(0, 2)) {
    const encoded = encodeURIComponent(learner.learnerId);
    const learnerRecords = await call("GET", `/api/teacher/records?learnerId=${encoded}`);
    check(
      (learnerRecords.payload?.records ?? []).every((record) => record.learnerId === learner.learnerId),
      "records",
      `按學習者查詢混入其他學習者的記錄（${learner.learnerId}）`,
    );

    for (const format of ["csv", "xlsx", "docx", "pdf"]) {
      const exported = await call("GET", `/api/teacher/records/export?learnerId=${encoded}&format=${format}`);
      const expectedCount = learnerRecords.payload?.records?.length ?? 0;
      check(exported.status === 200, "export", `${format} 匯出回應 ${exported.status}`);
      check(
        exported.headers.get("x-records-count") === String(expectedCount),
        "export",
        `${format} 匯出的記錄數（${exported.headers.get("x-records-count")}）與查詢結果（${expectedCount}）不符`,
      );
      if (format === "csv") {
        const { rows, learnerIds } = csvLearnerIds(exported.payload.toString("utf8"));
        check(
          sameSet([...learnerIds], [learner.learnerId]),
          "export",
          `CSV 匯出的學習者（${[...learnerIds].slice(0, 3).join("、")}）與所選（${learner.learnerId}）不符`,
        );
        check(
          rows.length === (learnerRecords.payload?.records ?? []).reduce(
            (sum, record) => sum + record.totalQuestions,
            0,
          ),
          "export",
          `CSV 列數（${rows.length}）與該學習者的題目總數不符`,
        );
      }
    }
  }

  // 不支援的格式
  const badFormat = await call("GET", "/api/teacher/records/export?format=xls");
  check(badFormat.status === 400, "export", `不支援格式應回 400，實際 ${badFormat.status}`);

  /* ---------------- [B] 題目管理 ---------------- */
  console.log("\n[B] 題目管理");
  if (!topic) {
    anomaly("topics", "沒有可用的課題，略過題目管理檢查");
  } else {
    const list = await call("GET", `/api/teacher/questions?topicId=${encodeURIComponent(topic.id)}`);
    check(list.status === 200, "questions", `題目清單回應 ${list.status}`);
    const questions = list.payload?.questions ?? [];
    info.push(`課題 ${topic.id} 題目 ${questions.length} 題`);
    check(questions.length > 0, "questions", "課題沒有任何題目");

    const published = questions.filter((question) => question.status === "published");
    const drafted = questions.filter((question) => question.status === "draft");
    for (const status of ["published", "draft"]) {
      const filtered = await call(
        "GET",
        `/api/teacher/questions?topicId=${encodeURIComponent(topic.id)}&status=${status}`,
      );
      check(
        (filtered.payload?.questions ?? []).every((question) => question.status === status),
        "questions",
        `狀態篩選 ${status} 混入其他狀態`,
      );
    }
    if (published.length > 0) {
      check(
        published.every((question) => question.correctAnswer.length > 0),
        "questions",
        "已發布題目缺少標準答案",
      );
    }
    if (drafted.length > 0) {
      info.push(`草稿 ${drafted.length} 題（教師需逐題覆核）`);
    }

    // 手動新增 → 修改 → 發布關卡 → 停用 → 刪除
    const sectionId = published[0]?.sectionId ?? drafted[0]?.sectionId;
    if (sectionId) {
      const created = await call("POST", "/api/teacher/questions", {
        topicId: topic.id,
        sectionId,
        questionType: "fill",
        difficulty: "basic",
        question: "模擬教師測試題：香港在 ______ 年回歸中國。（教師模擬建立，稍後會刪除）",
        options: [],
        correctAnswer: "1997",
        acceptedAnswers: ["1997年"],
        explanation: "香港於1997年7月1日回歸中國，成立特別行政區。",
        knowledgePoint: "模擬測試",
        sourceExcerpt: "模擬教師使用測試段落，並非教材原文。",
        sourceLocation: "模擬教師使用測試",
        sourceBlockIds: [],
        origin: "manual",
        status: "draft",
      });
      check(created.status === 201, "questions", `手動新增題目回應 ${created.status}`);
      const questionId = created.payload?.question?.id;
      check(created.payload?.question?.status === "draft", "questions", "手動新增題目應為草稿");

      if (questionId) {
        // 建立時直接指定 published 必須被拒絕
        const forcedPublish = await call("POST", "/api/teacher/questions", {
          topicId: topic.id,
          sectionId,
          questionType: "fill",
          difficulty: "basic",
          question: "模擬教師測試題：不應可直接發布 ______。",
          options: [],
          correctAnswer: "測試",
          explanation: "這題用來確認建立時不可直接指定已發布。",
          knowledgePoint: "模擬測試",
          sourceExcerpt: "模擬測試段落，並非教材原文。",
          sourceLocation: "模擬教師使用測試",
          sourceBlockIds: [],
          origin: "manual",
          status: "published",
        });
        check(
          forcedPublish.status === 409 || forcedPublish.status === 400,
          "questions",
          `建立時直接指定 published 應被拒絕，實際 ${forcedPublish.status}`,
        );
        if (forcedPublish.payload?.question?.id) {
          await call("DELETE", `/api/teacher/questions/${forcedPublish.payload.question.id}`);
        }

        // 未覆核就發布 → 409
        const publishWithoutReview = await call("PATCH", `/api/teacher/questions/${questionId}`, {
          action: "status",
          status: "published",
        });
        check(
          publishWithoutReview.status === 409,
          "questions",
          `未覆核即發布應回 409，實際 ${publishWithoutReview.status}`,
        );

        // 覆核通過後發布（覆核必須指明版本：expectedRevision）
        const revision = created.payload?.question?.revision ?? 1;
        const review = await call("POST", `/api/teacher/questions/${questionId}/review`, {
          decision: "approved",
          reason: "模擬教師使用測試：內容無誤",
          expectedRevision: revision,
        });
        check(review.status === 200, "review", `提交覆核回應 ${review.status}`, review.payload);
        const publishAfterReview = await call("PATCH", `/api/teacher/questions/${questionId}`, {
          action: "status",
          status: "published",
        });
        check(
          publishAfterReview.status === 200 &&
            publishAfterReview.payload?.view?.question?.status === "published",
          "questions",
          `覆核後發布失敗（${publishAfterReview.status}）`,
          publishAfterReview.payload,
        );

        // 修改已發布題目 → 自動下架
        const edited = await call("PATCH", `/api/teacher/questions/${questionId}`, {
          action: "edit",
          question: {
            topicId: topic.id,
            sectionId,
            questionType: "fill",
            difficulty: "basic",
            question: "模擬教師測試題（已修改）：香港在 ______ 年回歸中國。",
            options: [],
            correctAnswer: "1997",
            acceptedAnswers: ["1997年"],
            explanation: "香港於1997年7月1日回歸中國，成立特別行政區。",
            knowledgePoint: "模擬測試",
            sourceExcerpt: "模擬教師使用測試段落，並非教材原文。",
            sourceLocation: "模擬教師使用測試",
            sourceBlockIds: [],
            origin: "manual",
            status: "draft",
          },
        });
        check(edited.status === 200, "questions", `修改題目回應 ${edited.status}`, edited.payload);
        const editedQuestion = edited.payload?.view?.question;
        check(
          editedQuestion?.status !== "published",
          "questions",
          "修改已發布題目後仍為已發布（應自動下架）",
          editedQuestion,
        );
        check(
          (editedQuestion?.revision ?? 0) >= 2,
          "questions",
          `修改後版本沒有遞增（v${editedQuestion?.revision}）`,
        );

        // 停用
        const disabled = await call("PATCH", `/api/teacher/questions/${questionId}`, {
          action: "status",
          status: "disabled",
        });
        check(
          disabled.payload?.view?.question?.status === "disabled",
          "questions",
          `停用題目失敗（${disabled.status}）`,
          disabled.payload,
        );

        // 刪除
        const removed = await call("DELETE", `/api/teacher/questions/${questionId}`);
        check(removed.status === 200, "questions", `刪除題目回應 ${removed.status}`);
        const afterDelete = await call("GET", `/api/teacher/questions?topicId=${encodeURIComponent(topic.id)}`);
        check(
          !(afterDelete.payload?.questions ?? []).some((question) => question.id === questionId),
          "questions",
          "刪除後題目仍在清單中",
        );
      }
    }

    // 真實生成題目（可選）
    if (GENERATE > 0 && sectionId) {
      console.log(`  → 生成題目（每個分節 ${GENERATE} 題，真實 LLM）`);
      const generated = await call("POST", "/api/teacher/questions/generate", {
        topicId: topic.id,
        sectionIds: [sectionId],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: GENERATE,
      });
      check(generated.status === 200, "generate", `生成題目回應 ${generated.status}`);
      const created = generated.payload?.questions ?? [];
      info.push(`生成 ${created.length} 題（provider ${generated.payload?.provider}）`);
      check(created.length > 0, "generate", "生成題目沒有回傳任何題目");
      for (const question of created) {
        check(
          question.options.length === 0 || question.options.includes(question.correctAnswer),
          "generate",
          `生成題目的答案不在選項內：${question.id}`,
        );
        check(
          question.sectionId === sectionId,
          "generate",
          `生成題目分節不符：${question.id}（${question.sectionId}）`,
        );
        check(
          typeof question.sourceExcerpt === "string" && question.sourceExcerpt.length > 0,
          "generate",
          `生成題目沒有教材依據：${question.id}`,
        );
      }
      // 清理：刪除這次生成的題目，避免污染資料庫
      for (const question of created) {
        await call("DELETE", `/api/teacher/questions/${question.id}`);
      }
    }
  }

  /* ---------------- [C] 教師審核 ---------------- */
  console.log("\n[C] 教師審核（題目回報及覆核）");
  const reports = await call("GET", "/api/teacher/reports");
  check(reports.status === 200, "reports", `回報清單回應 ${reports.status}`);
  const reportList = reports.payload?.reports ?? [];
  info.push(`題目回報 ${reportList.length} 筆`);

  for (const status of ["open", "resolved", "dismissed"]) {
    const filtered = await call("GET", `/api/teacher/reports?status=${status}`);
    check(
      (filtered.payload?.reports ?? []).every((report) => report.status === status),
      "reports",
      `回報狀態篩選 ${status} 混入其他狀態`,
    );
  }

  const openReport = reportList.find((report) => report.status === "open");
  if (openReport) {
    // 已處理 → 重設 → 略過 → 重設（確保兩種標記都可運作且不影響題目）
    const resolved = await call("PATCH", `/api/teacher/reports?reportId=${openReport.id}`, {
      status: "resolved",
    });
    check(resolved.status === 200, "reports", `標記已處理回應 ${resolved.status}`);
    check(
      resolved.payload?.report?.status === "resolved",
      "reports",
      "標記已處理後狀態沒有更新",
    );
    const reopened = await call("PATCH", `/api/teacher/reports?reportId=${openReport.id}`, {
      status: "open",
    });
    check(reopened.payload?.report?.status === "open", "reports", "重設為待覆核失敗");
    const dismissed = await call("PATCH", `/api/teacher/reports?reportId=${openReport.id}`, {
      status: "dismissed",
    });
    check(dismissed.payload?.report?.status === "dismissed", "reports", "標記略過失敗");
    const reopenAgain = await call("PATCH", `/api/teacher/reports?reportId=${openReport.id}`, {
      status: "open",
    });
    check(reopenAgain.payload?.report?.status === "open", "reports", "再次重設為待覆核失敗");
  } else {
    console.log("  （沒有待覆核回報，略過狀態切換檢查）");
  }

  const missingReport = await call("PATCH", "/api/teacher/reports?reportId=report_does_not_exist", {
    status: "resolved",
  });
  check(missingReport.status === 404, "reports", `不存在的回報應回 404，實際 ${missingReport.status}`);

  // 覆核工作台及內容改進佇列**刻意**要求可識別的教師／管理員身分：
  // 未登入時一律 401（fail-closed），因此在示範模式（沒有登入）下只確認「有回應且不會 500」。
  for (const [path, label] of [
    ["/api/teacher/review-queue?queue=servability", "覆核工作台"],
    ["/api/teacher/content-improvement", "內容改進佇列"],
  ]) {
    const response = await call("GET", path);
    if (response.status === 401 || response.status === 403) {
      info.push(`${label}：未登入時回 ${response.status}（fail-closed，符合設計）`);
    } else {
      check(response.status === 200, "review", `${label}回應 ${response.status}`);
      info.push(`${label}：${response.payload?.total ?? response.payload?.items?.length ?? "已載入"}`);
    }
  }

  /* ---------------- 結果 ---------------- */
  console.log("\n──────── 結果 ────────");
  console.log(`請求 ${requestsRun} 次，檢查項目 ${checksRun}`);
  for (const line of info) console.log(`  · ${line}`);
  if (anomalies.length === 0) {
    console.log("\n✓ 沒有發現異常。");
  } else {
    console.log(`\n✗ 發現 ${anomalies.length} 項異常：`);
    const grouped = new Map();
    for (const anomalyItem of anomalies) {
      const list = grouped.get(anomalyItem.kind) ?? [];
      list.push(anomalyItem);
      grouped.set(anomalyItem.kind, list);
    }
    for (const [kind, list] of grouped) {
      console.log(`\n[${kind}] ${list.length} 項`);
      for (const item of list.slice(0, 8)) {
        console.log(`  · ${item.message}`);
        if (item.detail) console.log(`    ${JSON.stringify(item.detail).slice(0, 240)}`);
      }
    }
  }

  if (OUT) {
    const fs = await import("node:fs");
    fs.writeFileSync(
      OUT,
      JSON.stringify({ baseUrl: BASE_URL, requestsRun, checksRun, anomalies, info }, null, 2),
    );
    console.log(`\n報告：${OUT}`);
  }
  process.exit(anomalies.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("模擬教師使用時發生錯誤：", error);
  process.exit(1);
});
