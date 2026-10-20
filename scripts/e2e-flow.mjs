/**
 * 完整流程端對端測試（透過 HTTP 呼叫正在運行的網站）。
 *
 * 用法：
 *   npm run build && node scripts/e2e-flow.mjs --start   # 由腳本自行啟動 next start
 *   npm run dev                                          # 或先自行啟動，再執行
 *   node scripts/e2e-flow.mjs
 *
 * 建議以「匿名示範模式」啟動伺服器，令後台 API（教師端及管理員端）開放（本機測試）：
 *   LLM_PROVIDER=mock GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= APP_DATABASE_PATH=... APP_UPLOADS_DIR=... node scripts/e2e-flow.mjs --start
 *
 * 注意：以暫存 APP_DATABASE_PATH 執行時應一併指定 APP_UPLOADS_DIR。未指定時本腳本所上載的
 *       教材副本會寫進專案的 data/uploads，在暫存資料庫被丟棄後成為孤立檔案
 *       （2026-10-16 實測：單日累積 463 個、3.4 GB；見 README 第一節及第十一節）。
 *
 * 會測試：健康檢查（版本／資料庫狀態／不洩漏敏感資料）→ 登入狀態 → 課程結構（12 課題）→
 *        學生完整流程（建立練習 → 逐題作答 → 答案、解釋、教材來源 → 成績 → 重做錯題 →
 *        填充題自動評分）→ 管理員端（教材、OCR、分節及課題設定）及教師端（生成、發布及刪除題目）→
 *        學生回報題目與教師覆核 → 教師以學生身分測試（學習記錄分開）→
 *        後台功能分家（教師端／管理員端）→ 上載格式錯誤的友善訊息 → 教師查閱及下載學生練習記錄。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const SHOULD_START = process.argv.includes("--start");
const LEARNER_ID = `e2e-${Date.now()}`;

let passed = 0;
let failed = 0;

function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${extra ? ` → ${extra}` : ""}`);
  }
}

async function call(method, url, body, options = {}) {
  const response = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  // 不存在的路由及重導向會回 HTML（Next.js 404 頁），此時只取狀態碼
  const payload = text.length > 0 && contentType.includes("json") ? JSON.parse(text) : null;
  return { status: response.status, payload };
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { status } = await call("GET", "/api/health");
      if (status === 200) return true;
    } catch {
      // 伺服器尚未啟動
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function main() {
  let server = null;

  if (SHOULD_START) {
    const port = new URL(BASE_URL).port || "3000";
    const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
    console.log(`啟動 next start（連接埠 ${port}）…`);
    if (process.env.APP_DATABASE_PATH && !process.env.APP_UPLOADS_DIR) {
      console.log(
        "提示：已指定 APP_DATABASE_PATH 但未指定 APP_UPLOADS_DIR，本次上載的教材副本會寫進專案的 data/uploads（見 README 第一節）。",
      );
    }
    // 直接呼叫 Next.js 的 CLI，避免在 Windows 上呼叫 npm.cmd 的問題
    // 端對端測試以匿名示範模式執行（未設定 Google 憑證），而 `next start` 屬正式建置，
    // 後台預設 fail-closed；因此只在這個由測試啟動的子程序中明確允許示範模式。
    server = spawn(process.execPath, [nextBin, "start", "--port", port], {
      stdio: "ignore",
      cwd: process.cwd(),
      env: { ...process.env, HISTORY_ALLOW_UNSAFE_DEMO_MODE: "true" },
    });
  }

  const ready = await waitForServer();
  if (!ready) {
    console.error(`無法連線到 ${BASE_URL}，請先執行 npm run dev 或 npm run build && npm start。`);
    server?.kill();
    process.exit(1);
  }

  try {
    console.log("\n[1] 健康檢查及示範模式");
    const health = await call("GET", "/api/health");
    check("GET /api/health 回應正常", health.status === 200, `HTTP ${health.status}`);
    check("健康檢查回報 LLM provider", typeof health.payload?.llmProvider === "string");
    check("健康檢查回報應用程式版本", typeof health.payload?.version === "string");
    check(
      "健康檢查回報資料庫狀態（不回報路徑）",
      typeof health.payload?.database?.driver === "string" &&
        health.payload?.database?.status === "ok",
      JSON.stringify(health.payload?.database),
    );
    check("健康檢查回報 OCR provider", typeof health.payload?.ocrProvider === "string");
    check(
      "健康檢查回報登入及後台保護狀態",
      typeof health.payload?.authEnabled === "boolean" &&
        typeof health.payload?.staffApiOpen === "boolean",
    );
    check(
      "健康檢查回報定期維護狀態（資料保留期）",
      Array.isArray(health.payload?.maintenance) &&
        health.payload.maintenance.some((entry) => entry.kind === "ai-operation-retention"),
      JSON.stringify(health.payload?.maintenance)?.slice(0, 160),
    );
    check(
      "健康檢查回報學生名冊狀態（不含學生資料）",
      typeof health.payload?.roster?.enabled === "boolean" &&
        typeof health.payload?.roster?.source === "string" &&
        typeof health.payload?.roster?.enforce === "boolean",
      JSON.stringify(health.payload?.roster),
    );
    const healthText = JSON.stringify(health.payload);
    check(
      "健康檢查不洩漏資料庫路徑或憑證",
      !healthText.includes(".db") &&
        !healthText.includes("uploads") &&
        !/sk-|secret|token=/i.test(healthText),
      healthText.slice(0, 160),
    );
    console.log(`    provider：${health.payload?.llmProviderLabel}（版本 ${health.payload?.version}）`);

    console.log("\n[1b] 登入狀態（學校 Google 帳戶）");
    const auth = await call("GET", "/api/auth/session");
    check("GET /api/auth/session 回應正常", auth.status === 200, `HTTP ${auth.status}`);
    check(
      "登入狀態回報 enabled、requireSignIn 及 user",
      typeof auth.payload?.enabled === "boolean" &&
        typeof auth.payload?.requireSignIn === "boolean" &&
        auth.payload !== null &&
        "user" in auth.payload,
    );
    if (auth.payload?.enabled) {
      const anonymous = await call("GET", `/api/topics?learnerId=${LEARNER_ID}`);
      check("啟用登入後，未登入不可讀取學生資料", anonymous.status === 401, `HTTP ${anonymous.status}`);
      // 這個流程以匿名示範模式走完學生端及後台的功能（見 README「本機開發與測試」）。
      // 若伺服器已啟用學校帳戶登入，匿名步驟及後台 API 都會被拒絕而產生大量
      // 看似「功能失效」的失敗，因此這裡直接停下並說明正確的執行方式，
      // 避免把環境設定問題誤當成產品問題。
      if (!process.env.E2E_ALLOW_AUTH_ENABLED) {
        console.error(
          "\n端對端測試需要匿名示範模式（未設定 Google 憑證）：\n" +
            "  PowerShell：$env:GOOGLE_CLIENT_ID=' '; $env:GOOGLE_CLIENT_SECRET=' '; node scripts/e2e-flow.mjs --start\n" +
            "  或設定 AUTH_REQUIRE_SIGN_IN=false 並提供教師工作階段 cookie。\n" +
            "如仍要在已啟用登入的伺服器上執行（預期後台及匿名步驟失敗），請設定 E2E_ALLOW_AUTH_ENABLED=1。",
        );
        server?.kill();
        process.exit(2);
      }
      console.log("    已啟用學校帳戶登入：後台及匿名步驟預期會失敗（E2E_ALLOW_AUTH_ENABLED=1）");
    } else {
      check("未設定 Google 憑證時維持匿名模式", auth.payload?.user === null);
      console.log("    未設定 Google 憑證：維持匿名示範模式");
    }

    const loginHtml = await fetch(`${BASE_URL}/login`).then((response) => response.text());
    check("登入頁面可以開啟", loginHtml.includes("Google 帳戶登入"));
    if (health.payload?.roster?.enabled) {
      check("登入頁面說明學生名冊要求", loginHtml.includes("名冊"));
    }

    console.log("\n[2] 課程結構（教育局歷史科課程）");
    const topics = await call("GET", `/api/topics?learnerId=${LEARNER_ID}`);
    check("GET /api/topics 回應正常", topics.status === 200);
    const allTopics = topics.payload?.topics ?? [];
    const courseTopics = allTopics.filter((item) => item.level !== 0);
    check("包含 12 個課程課題", courseTopics.length === 12, `實際 ${courseTopics.length}`);
    check("學生端只看到 12 個課程課題", allTopics.length === 12, `實際 ${allTopics.length}`);

    const levelGroups = [1, 2, 3].map((level) => ({
      level,
      topics: courseTopics.filter((item) => item.level === level),
    }));
    check(
      "課題按中一／中二／中三分組（各 4 個）",
      levelGroups.every((group) => group.topics.length === 4),
      levelGroups.map((group) => `中${group.level}:${group.topics.length}`).join(" "),
    );
    check(
      "課題編號為 1 至 12",
      courseTopics.map((item) => item.topicNumber).sort((a, b) => a - b).join(",") ===
        "1,2,3,4,5,6,7,8,9,10,11,12",
    );
    check(
      "中二課題5 的主題文字正確",
      courseTopics
        .find((item) => item.topicNumber === 5)
        ?.themeText?.includes("近代世界"),
      courseTopics.find((item) => item.topicNumber === 5)?.themeText,
    );
    console.log(
      `    課題：${courseTopics
        .slice(0, 3)
        .map((item) => item.title)
        .join("、")} … 共 ${courseTopics.length} 個`,
    );

    const withMaterial = courseTopics.filter((item) => item.materialReady);
    check(
      "全部課程課題都已有教材",
      withMaterial.length === 12,
      `有教材 ${withMaterial.length}/12`,
    );

    const topic = courseTopics.find((item) => item.topicNumber === 5) ?? courseTopics[0];
    check("有可用的課題", Boolean(topic));
    check(
      "課題有分節及題目",
      (topic?.sections?.length ?? 0) > 0 && topic?.totalPublishedQuestions > 0,
    );

    // 找出有題目的分節（避免揀選到尚未有題目的分節）
    const sectionCandidates = (topic?.sections ?? []).flatMap((section) => [
      section,
      ...(section.children ?? []),
    ]);
    const section =
      sectionCandidates.find((item) => item.publishedQuestionCount > 0) ?? sectionCandidates[0];
    const childSection = section?.children?.[0] ?? section;
    console.log(
      `    課題：${topic?.title}；分節：${childSection?.title ?? section?.title}（${section?.publishedQuestionCount ?? 0} 題）`,
    );

    console.log("\n[2b] 教材發行權（版權閘門預設關閉）");
    // 先把所有教材還原為「未確認」（fail-closed 基準），令這一段可以重複執行：
    // 本流程後面會開放某份教材，若上一次執行未完成（例如中途失敗），
    // 殘留的狀態會令這裡看似「閘門失效」。這是測試隔離問題，不是產品問題。
    const materialsBefore = await call("GET", "/api/admin/materials");
    const alreadyGranted = (materialsBefore.payload?.documents ?? []).filter(
      (document) => document.studentDistribution === true,
    );
    for (const document of alreadyGranted) {
      await call("PATCH", `/api/admin/materials/${document.id}`, { studentDistribution: false });
    }
    if (alreadyGranted.length > 0) {
      console.log(`    重設 ${alreadyGranted.length} 份教材的學生使用權限後再測試閘門`);
    }

    // 由管理員明確確認某份教材可在平台發布，然後驗證學生才可使用其內容
    const lessonMaterials = await call("GET", "/api/admin/materials");
    const distributableDocument = (lessonMaterials.payload?.documents ?? []).find(
      (document) =>
        document.topicId === topic.id && document.kind !== "question-bank" && document.blockCount > 0,
    );
    if (distributableDocument) {
      // 開放前必須有版權／發行權確認
      const withoutRights = await call(
        "PATCH",
        `/api/admin/materials/${distributableDocument.id}`,
        { studentDistribution: true },
      );
      check(
        "開放學生使用需要版權確認（409）",
        withoutRights.status === 409,
        `HTTP ${withoutRights.status}`,
      );

      const withRights = await call(
        "PATCH",
        `/api/admin/materials/${distributableDocument.id}`,
        { studentDistribution: true, confirmRights: true },
      );
      // 檔名標示為教師版（例如 `_TE`）的文件必須額外做好內容安全覆核才可開放
      if (withRights.status === 409) {
        check("教師版教材需要額外內容覆核確認（409）", true);
        const confirmed = await call(
          "PATCH",
          `/api/admin/materials/${distributableDocument.id}`,
          { studentDistribution: true, confirmRights: true, confirmTeacherEdition: true },
        );
        check(
          "明確確認後可以開放給學生使用",
          confirmed.status === 200 && confirmed.payload?.document?.studentDistribution === true,
          JSON.stringify(confirmed.payload)?.slice(0, 200),
        );
        check(
          "兩項確認都記錄了確認者及時間",
          typeof confirmed.payload?.governance?.rightsConfirmedBy === "string" &&
            typeof confirmed.payload?.governance?.contentReviewedBy === "string" &&
            Number.isFinite(Date.parse(confirmed.payload?.governance?.rightsConfirmedAt ?? "")),
        );
      } else {
        check("管理員可以確認教材的學生閱讀權限", withRights.status === 200, `HTTP ${withRights.status}`);
      }

      const topicsAfterRights = await call(
        "GET",
        `/api/topics/${topic.id}?learnerId=${LEARNER_ID}`,
      );
      const studentBlockTotal = (topicsAfterRights.payload?.topic?.sections ?? []).reduce(
        (total, section) => total + (section.studentMaterialBlockCount ?? 0),
        0,
      );
      check(
        "確認版權後學生才有可用的教材段落",
        studentBlockTotal > 0,
        `可用段落：${studentBlockTotal}`,
      );
    } else {
      check("找到可測試版權閘門的教材文件", false, "找不到已對應課題且含段落的教材文件");
    }

    console.log("\n[3] 建立練習（選擇題 + 填充題）");
    const created = await call("POST", "/api/practice", {
      learnerId: LEARNER_ID,
      topicId: topic.id,
      sectionIds: [childSection.id],
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 3,
      mode: "standard",
      sourceSessionId: null,
    });
    check("POST /api/practice 建立練習", created.status === 201, JSON.stringify(created.payload)?.slice(0, 200));
    const session = created.payload?.session;
    const questions = created.payload?.questions ?? [];
    check("練習包含題目", questions.length > 0, `題數：${questions.length}`);
    check(
      "作答前不會洩露答案",
      questions.every((question) => question.correctAnswer === undefined && question.explanation === undefined),
    );
    console.log(`    練習 ${session?.id}，共 ${questions.length} 題`);

    console.log("\n[4] 作答、查看答案及教材來源");
    const answers = [];
    for (const [index, question] of questions.entries()) {
      const answer =
        question.questionType === "mc"
          ? index === 0
            ? question.options[0]
            : question.options[question.options.length - 1]
          : "測試答案";
      const submitted = await call("POST", `/api/practice/${session.id}/answers`, {
        learnerId: LEARNER_ID,
        questionId: question.id,
        answer,
      });
      check(`第 ${index + 1} 題提交成功`, submitted.status === 200, JSON.stringify(submitted.payload)?.slice(0, 160));
      answers.push(submitted.payload?.feedback);
    }

    const firstFeedback = answers[0];
    check("回饋包含標準答案", Boolean(firstFeedback?.correctAnswer));
    check("回饋包含解釋", Boolean(firstFeedback?.explanation));
    check("回饋包含知識點", Boolean(firstFeedback?.knowledgePoint));
    // 教材節錄可否顯示由 source-visibility.ts 決定（fail-closed）：匯入的校內試題
    // （origin = school-paper）沒有教材段落依據時，一律不向學生顯示檔名、題號及節錄。
    // 因此這裡驗證的是「政策一致」，而不是「一定有節錄」：
    //   - 有顯示 → 來源位置及節錄都必須存在；
    //   - 沒顯示 → 兩者都必須為空，並且必須標示 sourceWithheld。
    if (firstFeedback?.sourceWithheld === true) {
      check("未核實來源的題目不會向學生顯示來源位置", !firstFeedback?.sourceLocation);
      check("未核實來源的題目不會向學生顯示原文節錄", !firstFeedback?.sourceExcerpt);
      check("未核實來源的題目會標示已略去節錄", firstFeedback?.sourceWithheld === true);
    } else {
      check("可顯示來源時，回饋包含教材來源位置", Boolean(firstFeedback?.sourceLocation));
      check("可顯示來源時，回饋包含教材原文節錄", Boolean(firstFeedback?.sourceExcerpt));
    }

    // 撤回教材發行權後，引用該教材的題目必須立即不再顯示原文節錄
    // （節錄只在來源已確認可向學生發布時才回傳）。題目本身、答案及解釋不受影響。
    const citesMaterial = (firstFeedback?.sourceBlockIds ?? []).length > 0;
    if (distributableDocument && citesMaterial) {
      const revoked = await call("PATCH", `/api/admin/materials/${distributableDocument.id}`, {
        studentDistribution: false,
      });
      check("撤回教材發行權成功", revoked.status === 200, `HTTP ${revoked.status}`);

      const afterRevoke = await call("GET", `/api/practice/${session.id}/result?learnerId=${LEARNER_ID}`);
      const revokedFeedback = (afterRevoke.payload?.feedback ?? [])[0];
      check(
        "撤回後不再回傳教材原文節錄",
        revokedFeedback?.sourceExcerpt === null || revokedFeedback?.sourceExcerpt === undefined,
        `sourceExcerpt=${String(revokedFeedback?.sourceExcerpt ?? "").slice(0, 40)}`,
      );
      check("撤回後回饋標示已略去節錄", revokedFeedback?.sourceWithheld === true);
      check(
        "撤回後仍保留標準答案及解釋",
        Boolean(revokedFeedback?.correctAnswer) && Boolean(revokedFeedback?.explanation),
      );

      // 還原為「已確認」狀態，令後續步驟及下一次執行由一致狀態開始
      const restored = await call("PATCH", `/api/admin/materials/${distributableDocument.id}`, {
        studentDistribution: true,
        confirmRights: true,
        confirmTeacherEdition: true,
      });
      check("重新確認版權後可以再次開放", restored.status === 200, `HTTP ${restored.status}`);
      const afterRestore = await call("GET", `/api/practice/${session.id}/result?learnerId=${LEARNER_ID}`);
      check(
        "重新確認後節錄回復顯示",
        Boolean((afterRestore.payload?.feedback ?? [])[0]?.sourceExcerpt),
      );
    } else {
      check(
        "（此練習的題目沒有引用教材段落，節錄屬作者標註而不受發行權影響）",
        firstFeedback !== undefined,
      );
    }

    const repeat = await call("POST", `/api/practice/${session.id}/answers`, {
      learnerId: LEARNER_ID,
      questionId: questions[0].id,
      answer: questions[0].questionType === "mc" ? questions[0].options[0] : "測試答案",
    });
    check("重複提交不會重複計分", repeat.payload?.recorded === false);

    console.log("\n[5] 成績及需要重溫的知識點");
    const completed = await call("POST", `/api/practice/${session.id}/complete`, {
      learnerId: LEARNER_ID,
    });
    check("POST complete 回傳成績", completed.status === 200);
    check("成績包含正確率", completed.payload?.accuracy !== undefined);
    check("成績包含逐題回饋", (completed.payload?.feedback?.length ?? 0) === questions.length);
    console.log(
      `    答對 ${completed.payload?.correctCount}/${completed.payload?.gradedCount}，正確率 ${
        completed.payload?.accuracy === null ? "—" : `${Math.round(completed.payload.accuracy * 100)}%`
      }`,
    );

    console.log("\n[6] 針對錯題再練習");
    const wrongOnly = await call("POST", "/api/practice", {
      learnerId: LEARNER_ID,
      topicId: topic.id,
      sectionIds: [childSection.id],
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 3,
      mode: "wrong-only",
      sourceSessionId: session.id,
    });
    if (wrongOnly.status === 201) {
      check("可以建立錯題練習", (wrongOnly.payload?.questions?.length ?? 0) > 0);
      console.log(`    錯題練習 ${wrongOnly.payload?.session?.id}`);
    } else {
      check("沒有錯題時會回報清楚訊息", wrongOnly.status === 409, JSON.stringify(wrongOnly.payload));
    }

    console.log("\n[7] 填充題自動評分");
    // 用分類層（section，不是 childSection）抽題：E2E 選中的 childSection 只有選擇題，
    // 若固定用 childSection 會永遠得到「沒有填充題」。用父分節（含子分節）才能實際
    // 驗證填充題自動評分，而不是把缺乏題目誤當成功能失敗。
    const fillPractice = await call("POST", "/api/practice", {
      learnerId: LEARNER_ID,
      topicId: topic.id,
      sectionIds: [section.id],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    if (fillPractice.status === 201 && fillPractice.payload.questions.length > 0) {
      const fillQuestion = fillPractice.payload.questions[0];
      const submitted = await call("POST", `/api/practice/${fillPractice.payload.session.id}/answers`, {
        learnerId: LEARNER_ID,
        questionId: fillQuestion.id,
        answer: "我的作答內容",
      });
      check("填充題會自動評分", submitted.payload?.feedback?.autoGraded === true);
      check("填充題不提供得分要點", (submitted.payload?.feedback?.gradingPoints?.length ?? 0) === 0);
    } else {
      check("此分節有填充題可用", false, JSON.stringify(fillPractice.payload)?.slice(0, 160));
    }

    console.log("\n[8] 管理員後台：教材及題目");
    const materials = await call("GET", "/api/admin/materials");
    check("GET /api/admin/materials 回應正常", materials.status === 200);
    check("教材清單包含文件", (materials.payload?.documents?.length ?? 0) > 0);
    const readyDocument = materials.payload?.documents?.find((document) => document.status === "ready");
    check("教材擷取成功並有段落", (readyDocument?.blockCount ?? 0) > 0);
    check(
      "教材已對應課程課題",
      (materials.payload?.documents ?? []).filter((document) => document.topicId).length >= 12,
      `已對應 ${(materials.payload?.documents ?? []).filter((d) => d.topicId).length} 份`,
    );

    if (readyDocument) {
      const blocks = await call("GET", `/api/admin/materials/${readyDocument.id}`);
      check("可以預覽教材段落", (blocks.payload?.blocks?.length ?? 0) > 0);
      const imageBlock = blocks.payload?.blocks?.find((block) => block.type === "image");
      check("圖片段落標示為未能擷取", !imageBlock || imageBlock.text.includes("未能自動擷取"));
    }

    const candidateSections = [
      childSection,
      ...topic.sections,
      ...topic.sections.flatMap((item) => item.children ?? []),
    ].filter(Boolean);

    let generated = null;
    let generatedSection = null;
    let lastAttempt = null;
    for (const candidate of candidateSections) {
      const attempt = await call("POST", "/api/teacher/questions/generate", {
        topicId: topic.id,
        sectionIds: [candidate.id],
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        questionCount: 2,
      });
      lastAttempt = attempt;
      if (attempt.status === 200) {
        generated = attempt;
        generatedSection = candidate;
        break;
      }
    }

    check(
      "至少一個分節可以生成題目預覽",
      generated !== null,
      JSON.stringify(lastAttempt?.payload)?.slice(0, 200),
    );
    if (!generated) {
      check(
        "生成失敗時會提供清楚的說明",
        typeof lastAttempt?.payload?.error === "string" &&
          lastAttempt.payload.error.includes("未能生成"),
      );
    }
    console.log(`    生成分節：${generatedSection?.title ?? "（無）"}`);
    check("生成的題目均有教材依據", (generated?.payload?.questions ?? []).every((q) => q.sourceVerified));
    check(
      "生成的題目附有教材節錄",
      (generated?.payload?.questions ?? []).every((q) => (q.sourceExcerpt ?? "").length > 0),
    );
    check(
      "生成的題目已記錄自動品質驗證結果（Sprint 7.8）",
      (generated?.payload?.questions ?? []).every((q) => q.autoValidatedAt !== null),
      JSON.stringify((generated?.payload?.questions ?? []).map((q) => q.autoValidatedAt).slice(0, 3)),
    );
    check(
      "通過自動品質驗證的題目即時供學生練習，毋須教師預先批准",
      (generated?.payload?.questions ?? []).every((q) => q.status === "published"),
      JSON.stringify((generated?.payload?.questions ?? []).map((q) => q.status).slice(0, 3)),
    );
    check(
      "選擇題的標準答案在選項之內",
      (generated?.payload?.questions ?? [])
        .filter((q) => q.questionType === "mc")
        .every((q) => q.options.includes(q.correctAnswer)),
    );
    console.log(
      `    provider：${generated?.payload?.providerLabel}，接受 ${generated?.payload?.questions?.length} 題，捨棄 ${generated?.payload?.discardedCount} 題`,
    );

    console.log("\n[9] 上載不支援的格式會得到清楚錯誤訊息");
    const formData = new FormData();
    formData.append("file", new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }));
    const uploadResponse = await fetch(`${BASE_URL}/api/admin/materials`, {
      method: "POST",
      body: formData,
    });
    check("不支援格式會被拒絕", uploadResponse.status === 400, `HTTP ${uploadResponse.status}`);
    const uploadPayload = await uploadResponse.json();
    check(
      "錯誤訊息說明支援的格式",
      typeof uploadPayload?.error === "string" && uploadPayload.error.includes(".docx"),
      uploadPayload?.error,
    );

    console.log("\n[9b] OCR（圖片文字辨識）");
    const ocrInfo = await call("GET", "/api/admin/materials/import");
    check("可以查詢 OCR 引擎狀態", ocrInfo.status === 200);
    const ocrEngine = ocrInfo.payload?.ocr;
    check(
      "OCR 已啟用（本機 tesseract 或 Google Cloud Vision）",
      ocrEngine?.enabled === true,
      ocrEngine?.notice ?? "未啟用",
    );
    console.log(`    引擎：${ocrEngine?.providerLabel}（語言 ${ocrEngine?.languages}）`);

    const ocrDocument = (materials.payload?.documents ?? []).find(
      (document) => document.status === "ready" && document.imageCount > 0,
    );
    check("找到含圖片的教材", Boolean(ocrDocument), `${ocrDocument?.fileName}`);

    if (ocrDocument) {
      const started = await call("POST", `/api/admin/materials/${ocrDocument.id}/ocr`, {}, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      check("可以啟動 OCR（背景執行或同步完成）", started.status === 202 || started.status === 200);

      // 等待 OCR 完成（最多 3 分鐘）
      let status = null;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const poll = await call("GET", `/api/admin/materials/${ocrDocument.id}/ocr`);
        status = poll.payload;
        if (status && status.running === false && status.status !== "running") break;
      }

      check(
        "OCR 完成（狀態為 done 或 partial）",
        status?.status === "done" || status?.status === "partial",
        `狀態 ${status?.status}：${status?.message ?? ""}`,
      );
      check(
        "OCR 回報辨識結果",
        typeof status?.recognizedCount === "number",
        `辨識 ${status?.recognizedCount} 張，略過 ${status?.skippedCount} 張`,
      );
      console.log(`    ${status?.message ?? ""}`);

      const blocksAfterOcr = await call("GET", `/api/admin/materials/${ocrDocument.id}`);
      const ocrBlocks = (blocksAfterOcr.payload?.blocks ?? []).filter(
        (block) => block.extractionMethod === "ocr",
      );
      check(
        "OCR 文字已寫入教材段落並標示來源",
        ocrBlocks.length > 0 &&
          ocrBlocks.every((block) => block.text.includes("以上文字由 OCR 從圖片擷取")),
        `OCR 段落 ${ocrBlocks.length} 段`,
      );
      check(
        "OCR 段落標示為需要教師核對",
        ocrBlocks.every((block) => block.sourceLocation.includes("OCR")),
      );
      if (ocrBlocks[0]) {
        console.log(`    範例（${ocrBlocks[0].sourceLocation}）：`);
        console.log(`      ${ocrBlocks[0].text.split("\n")[0].slice(0, 80)}`);
      }
    }

    console.log("\n[10] 上載 DOCX 教材（管理員流程）");
    const pilotPath = path.join(process.cwd(), "materials", "課題5 近代歐洲的興起.docx");
    if (fs.existsSync(pilotPath)) {
      const docxForm = new FormData();
      docxForm.append(
        "file",
        new File([fs.readFileSync(pilotPath)], "e2e-upload.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      docxForm.append("topicId", topic.id);
      const uploadDocx = await fetch(`${BASE_URL}/api/admin/materials`, {
        method: "POST",
        body: docxForm,
      });
      const payload = await uploadDocx.json();
      check("DOCX 上載成功", uploadDocx.status === 200, JSON.stringify(payload)?.slice(0, 200));
      check("DOCX 擷取到段落", (payload?.blockCount ?? 0) > 100);
      check("有圖片未能擷取的提示", (payload?.warnings ?? []).some((w) => w.includes("圖片")));
      if (payload?.document?.id) {
        const deleted = await call("DELETE", `/api/admin/materials/${payload.document.id}`);
        check("可以刪除測試上載的教材", deleted.status === 200);
      }
    } else {
      console.log("    （找不到試點教材，略過上載測試）");
    }

    console.log("\n[11] 管理介面：修改分節及題目狀態");
    const generatedQuestion = generated?.payload?.questions?.[0];
    if (generatedQuestion) {
      // 發布關卡（Sprint 7.8）：生成流程已為題目記錄自動品質驗證，因此可直接發布；
      // 「沒有任何驗證紀錄就不可發布」由下面手動建立的題目驗證（該題沒有驗證紀錄）。
      const autoPublished = await call("PATCH", `/api/teacher/questions/${generatedQuestion.id}`, {
        action: "status",
        status: "published",
      });
      check(
        "通過自動品質驗證的題目可以發布（Sprint 7.8）",
        autoPublished.status === 200 &&
          autoPublished.payload?.view?.question?.status === "published",
        `HTTP ${autoPublished.status}`,
      );
      // 覆核必須指明教師看到的版本（Sprint 8.7）：先確認版本不符時會被拒絕
      const reviewRevision =
        autoPublished.payload?.view?.question?.revision ?? generatedQuestion.revision ?? 1;
      const staleReview = await call(
        "POST",
        `/api/teacher/questions/${generatedQuestion.id}/review`,
        { decision: "approved", expectedRevision: reviewRevision + 1 },
      );
      check(
        "覆核指明的版本與現行版本不符時會被拒絕（409）",
        staleReview.status === 409,
        `HTTP ${staleReview.status}`,
      );

      // 教師手動建立的題目沒有自動驗證或人工覆核紀錄 → 不可發布（409）
      const manual = await call("POST", "/api/teacher/questions", {
        topicId: topic.id,
        sectionId: childSection.id,
        questionType: "mc",
        difficulty: "basic",
        question: "E2E 測試：以下哪一項是教師手動建立的題目？",
        options: ["手動建立", "自動生成", "匯入試題", "示範題庫"],
        correctAnswer: "手動建立",
        acceptedAnswers: [],
        explanation: "這是 E2E 測試用手動建立的題目，用來驗證發布關卡。",
        knowledgePoint: "E2E 測試",
        sourceExcerpt: "E2E 測試用節錄",
        sourceLocation: "E2E 測試用位置",
        sourceBlockIds: [],
        gradingPoints: [],
        origin: "manual",
        status: "draft",
      });
      const manualId = manual.payload?.question?.id;
      if (manualId) {
        const blocked = await call("PATCH", `/api/teacher/questions/${manualId}`, {
          action: "status",
          status: "published",
        });
        check(
          "沒有任何驗證紀錄的題目不可發布（409）",
          blocked.status === 409,
          `HTTP ${blocked.status}`,
        );
        const removedManual = await call("DELETE", `/api/teacher/questions/${manualId}`);
        check("可以刪除測試用的手動題目", removedManual.status === 200);
      } else {
        check("可以建立教師手動題目（測試發布關卡用）", false, JSON.stringify(manual.payload)?.slice(0, 200));
      }

      const reviewed = await call(
        "POST",
        `/api/teacher/questions/${generatedQuestion.id}/review`,
        { decision: "approved", expectedRevision: reviewRevision },
      );
      check(
        "教師可以記錄人工覆核（通過）",
        reviewed.status === 200 && reviewed.payload?.view?.reviewState === "approved",
        JSON.stringify(reviewed.payload)?.slice(0, 200),
      );
      check(
        "覆核紀錄包含覆核者及版本",
        reviewed.payload?.view?.approvedReview?.revision >= 1 &&
          typeof reviewed.payload?.view?.approvedReview?.reviewerEmail === "string",
      );

      // 覆核後即可發布（狀態與覆核狀態一致）
      const republished = await call("PATCH", `/api/teacher/questions/${generatedQuestion.id}`, {
        action: "status",
        status: "published",
      });
      check(
        "已覆核的題目可以發布",
        republished.status === 200 &&
          republished.payload?.view?.question?.status === "published",
        JSON.stringify(republished.payload)?.slice(0, 200),
      );

      // 重複提交相同覆核決定不會產生重複紀錄（冪等）
      const again = await call(
        "POST",
        `/api/teacher/questions/${generatedQuestion.id}/review`,
        { decision: "approved", expectedRevision: reviewRevision },
      );
      check("重複覆核不會重複記錄", again.payload?.created === false);

      const removed = await call("DELETE", `/api/teacher/questions/${generatedQuestion.id}`);
      check("可以刪除題目", removed.status === 200);
    }
    const renamed = await call("PATCH", `/api/admin/sections/${childSection.id}`, {
      summary: `E2E 測試更新 ${new Date().toISOString()}`,
    });
    check("可以修改分節內容", renamed.status === 200);
    const topicPublish = await call("PATCH", `/api/admin/topics/${topic.id}`, { published: true });
    check("可以設定課題發布狀態", topicPublish.status === 200);

    console.log("\n[11b] 管理員端系統狀態及儀表板統計");
    const systemHealth = await call("GET", "/api/admin/system/health");
    check("GET /api/admin/system/health 回應正常", systemHealth.status === 200);
    check("系統狀態包含版本及資料庫狀態", typeof systemHealth.payload?.version === "string");
    check(
      "系統狀態包含 LLM、OCR 及登入資訊",
      typeof systemHealth.payload?.llm?.providerLabel === "string" &&
        typeof systemHealth.payload?.ocr?.provider === "string" &&
        typeof systemHealth.payload?.auth?.enabled === "boolean",
    );
    check(
      "系統狀態包含設定提示（陣列）",
      Array.isArray(systemHealth.payload?.configIssues),
    );
    check(
      "系統狀態包含學生名冊資訊（來源、是否載入、人數）",
      typeof systemHealth.payload?.roster?.source === "string" &&
        typeof systemHealth.payload?.roster?.loaded === "boolean",
      JSON.stringify(systemHealth.payload?.roster),
    );
    if (systemHealth.payload?.roster?.error) {
      console.log(`    名冊讀取提示：${systemHealth.payload.roster.error}`);
    }
    const overview = await call("GET", "/api/admin/system/overview");
    check("GET /api/admin/system/overview 回應正常", overview.status === 200);
    check(
      "儀表板統計包含課題、教材、題庫及 AI 用量",
      typeof overview.payload?.overview?.questions?.total === "number" &&
        typeof overview.payload?.overview?.materials?.documents === "number" &&
        typeof overview.payload?.observability?.llmRequests === "number",
    );
    console.log(
      `    題庫 ${overview.payload?.overview?.questions?.total} 題（已發布 ${overview.payload?.overview?.questions?.published}），` +
        `待覆核回報 ${overview.payload?.overview?.questions?.flagged}`,
    );

    console.log("\n[11c] 學生回報題目及教師覆核");
    const reportTarget = questions[questions.length - 1];
    const submittedReport = await call("POST", "/api/reports", {
      learnerId: LEARNER_ID,
      questionId: reportTarget.id,
      sessionId: session.id,
      reason: "answer-disputed",
      detail: "E2E 測試回報：請教師核對答案。",
    });
    check("學生可以回報題目", submittedReport.status === 201, JSON.stringify(submittedReport.payload));
    check("回報回應包含狀態", submittedReport.payload?.status === "open");

    const duplicateReport = await call("POST", "/api/reports", {
      learnerId: LEARNER_ID,
      questionId: reportTarget.id,
      sessionId: session.id,
      reason: "unclear",
      detail: "",
    });
    check("重複回報不會產生重複記錄", duplicateReport.payload?.alreadyReported === true);

    const reportList = await call("GET", "/api/teacher/reports?status=open");
    check("教師可以查看待覆核回報", reportList.status === 200);
    const openReport = (reportList.payload?.reports ?? [])[0];
    check("回報清單包含剛才的回報", Boolean(openReport), JSON.stringify(reportList.payload)?.slice(0, 160));
    check("回報附有題目文字及課題名稱", Boolean(openReport?.question && openReport?.topicTitle));

    if (openReport) {
      const resolved = await call(
        "PATCH",
        `/api/teacher/reports?reportId=${encodeURIComponent(openReport.id)}`,
        { status: "resolved" },
      );
      check("教師可以把回報標記為已處理", resolved.status === 200 && resolved.payload?.report?.status === "resolved");

      const questionAfter = await call("GET", `/api/teacher/questions?topicId=${topic.id}`);
      const stillThere = (questionAfter.payload?.questions ?? []).find((item) => item.id === reportTarget.id);
      check("回報不會刪除或停用題目", Boolean(stillThere) && stillThere.status !== "disabled");
    }

    console.log("\n[11d] 回報 AI 即時生成的題目（只存在於練習快照）");
    // 即時生成需要教材依據，因此選一個已匯入教材的分節
    const instantCandidates = (topic?.sections ?? []).flatMap((item) => [
      item,
      ...(item.children ?? []),
    ]);
    const instantSection = instantCandidates.find((item) => item.materialBlockCount > 0);
    check(
      "找到有教材依據的分節（AI 即時生成用）",
      Boolean(instantSection),
      "請先執行 npm run import:materials -- --curriculum 匯入教材",
    );
    const instant = await call("POST", "/api/practice", {
      learnerId: LEARNER_ID,
      topicId: topic.id,
      sectionIds: [instantSection?.id ?? childSection.id],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
      questionSource: "ai",
    });
    check(
      "AI 即時生成練習建立成功",
      instant.status === 201,
      JSON.stringify(instant.payload)?.slice(0, 200),
    );
    const instantQuestion = instant.payload?.questions?.[0];
    const instantReport = await call("POST", "/api/reports", {
      learnerId: LEARNER_ID,
      questionId: instantQuestion?.id,
      sessionId: instant.payload?.session?.id,
      reason: "unclear",
      detail: "E2E 測試回報：即時生成題目用語不清楚。",
    });
    check(
      "即時生成的題目也可以回報",
      instantReport.status === 201,
      JSON.stringify(instantReport.payload)?.slice(0, 200),
    );

    const instantList = await call("GET", "/api/teacher/reports?status=open");
    const instantEntry = (instantList.payload?.reports ?? []).find(
      (item) => item.questionId === instantQuestion?.id,
    );
    check("教師端看到即時生成題目的回報", Boolean(instantEntry));
    check("教師端標示該題不在題庫", instantEntry?.inQuestionBank === false);
    check("回報附有即時生成題目的內容", Boolean(instantEntry?.question));

    console.log("\n[11e] 學習記錄按學習者分開（未登入不可冒用帳戶身分）");
    // 未登入時不可使用由帳戶推導的學習者 ID（school:／teacher:／admin:）：
    // 否則只要猜中他人的校內電郵，就可以讀取他人的學習記錄。
    const forgedIds = [
      `school:e2e-${Date.now()}@pochiu.edu.hk`,
      `teacher:e2e-teacher-${Date.now()}@example.com`,
      `admin:e2e-admin-${Date.now()}@example.com`,
    ];
    for (const forged of forgedIds) {
      const forgedRead = await call("GET", `/api/topics?learnerId=${encodeURIComponent(forged)}`);
      check(
        `未登入不可冒用帳戶學習者 ID（${forged.split(":")[0]}:…）`,
        forgedRead.status === 401,
        `HTTP ${forgedRead.status}`,
      );
    }
    const secondLearner = `e2e-second-${Date.now()}`;
    const teacherPractice = await call("POST", "/api/practice", {
      learnerId: secondLearner,
      topicId: topic.id,
      sectionIds: [childSection.id],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    check("另一位學習者可以建立練習", teacherPractice.status === 201);
    check(
      "練習記錄屬於建立練習的學習者",
      teacherPractice.payload?.session?.learnerId === secondLearner,
    );
    const stolenRead = await call(
      "GET",
      `/api/practice/${teacherPractice.payload?.session?.id}?learnerId=${LEARNER_ID}`,
    );
    check(
      "其他學習者不可讀取他人的練習記錄",
      stolenRead.status === 403,
      `HTTP ${stolenRead.status}`,
    );
    const anonymousTeacherDenied = await call("GET", `/api/practice/${teacherPractice.payload?.session?.id}`);
    check(
      "沒有學習者身分時不可讀取練習記錄",
      anonymousTeacherDenied.status === 400 || anonymousTeacherDenied.status === 401,
      `HTTP ${anonymousTeacherDenied.status}`,
    );

    console.log("\n[11f] 後台功能分家（教師端 vs 管理員端）");
    const teacherSideMaterials = await call("GET", "/api/teacher/materials");
    check(
      "教材 API 已移出教師端（舊路徑不再提供）",
      teacherSideMaterials.status === 404,
      `HTTP ${teacherSideMaterials.status}`,
    );
    const adminSideQuestions = await call("GET", `/api/admin/questions?topicId=${topic.id}`);
    check(
      "題目 API 已統一在教師端（/api/admin/questions 不再提供）",
      adminSideQuestions.status === 404,
      `HTTP ${adminSideQuestions.status}`,
    );
    const adminMaterials = await call("GET", "/api/admin/materials");
    check("管理員端教材 API 回應正常", adminMaterials.status === 200);
    const teacherOverview = await call("GET", "/api/teacher/overview");
    check("教師端首頁統計回應正常", teacherOverview.status === 200);
    check(
      "教師端統計只包含題庫及練習記錄（不含教材）",
      typeof teacherOverview.payload?.questions?.total === "number" &&
        typeof teacherOverview.payload?.records?.sessions === "number" &&
        teacherOverview.payload?.materials === undefined,
    );

    console.log("\n[12] 教師端學生練習記錄（查閱及下載）");
    const records = await call("GET", "/api/teacher/records");
    check("教師可讀取學生練習記錄", records.status === 200, `HTTP ${records.status}`);
    const learnerRecords = (records.payload?.records ?? []).filter(
      (record) => record.learnerId === LEARNER_ID,
    );
    check("記錄包含該學習者的練習", learnerRecords.length > 0);
    check(
      "記錄包含作答日期、課題、題型及答對／答錯的題目",
      learnerRecords.length > 0 &&
        learnerRecords.every(
          (record) =>
            typeof record.createdAt === "string" &&
            typeof record.topicTitle === "string" &&
            Array.isArray(record.questionTypeLabels) &&
            record.questions.every(
              (question) =>
                typeof question.question === "string" &&
                typeof question.correctAnswer === "string" &&
                (question.isCorrect === null || typeof question.isCorrect === "boolean"),
            ),
        ),
    );
    const csvResponse = await fetch(`${BASE_URL}/api/teacher/records/export`);
    // BOM 必須以原始位元組檢查：fetch 的 text() 會依規範把 UTF-8 BOM 吃掉
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
    const csvText = csvBytes.toString("utf8");
    check(
      "教師可下載練習記錄 CSV",
      csvResponse.status === 200 && csvText.includes("作答日期") && csvText.includes("結果"),
      `HTTP ${csvResponse.status}`,
    );
    check(
      "CSV 以 UTF-8 BOM 開頭（Excel 可正常開啟）",
      csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
      `前三 byte：${csvBytes.subarray(0, 3).toString("hex")}`,
    );
  } finally {
    if (server) {
      server.kill();
    }
  }

  console.log(`\n結果：${passed} 項通過，${failed} 項失敗`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("端對端測試發生錯誤：", error);
  process.exit(1);
});

