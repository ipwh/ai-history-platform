import type { DatabaseSync } from "node:sqlite";

export interface PlatformUsageFilters {
  from?: string | null;
  to?: string | null;
}

interface UsageTotal {
  sessions: number;
  learners: number;
  assignedQuestions: number;
  answeredQuestions: number;
  gradedQuestions: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
}

interface GroupUsage {
  sessions: number;
  assignedQuestions: number;
  answeredQuestions: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
}

export interface PlatformUsageReport {
  generatedAt: string;
  databaseRange: { from: string | null; to: string | null };
  filters: { from: string | null; to: string | null; timeZone: "Asia/Hong_Kong" };
  rosterUpdatedAt: string | null;
  overall: UsageTotal;
  byMode: Array<GroupUsage & { mode: string; label: string }>;
  byOrigin: Array<GroupUsage & { origin: string; label: string }>;
  byClass: Array<GroupUsage & { className: string; learners: number }>;
  byStudent: Array<
    GroupUsage & {
      learnerId: string;
      name: string | null;
      className: string | null;
      studentNumber: string | null;
      email: string | null;
      lastAt: string;
    }
  >;
  byTopic: Array<GroupUsage & { topicId: string; topicTitle: string; learners: number }>;
  byDay: Array<GroupUsage & { day: string; learners: number }>;
  reviewEffectiveness: {
    sessions: number;
    answeredQuestions: number;
    correct: number;
    accuracy: number | null;
    matchedPriorQuestions: number;
    improvedQuestions: number;
    improvementRate: number | null;
  };
}

function whereClause(filters: PlatformUsageFilters): { clause: string; params: string[] } {
  const conditions = [
    "s.learner_id NOT LIKE 'teacher:%'",
    "s.learner_id NOT LIKE 'admin:%'",
    "s.learner_id NOT LIKE 'e2e-%'",
  ];
  const params: string[] = [];
  if (filters.from) {
    conditions.push("substr(datetime(s.created_at, '+8 hours'), 1, 10) >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("substr(datetime(s.created_at, '+8 hours'), 1, 10) <= ?");
    params.push(filters.to);
  }
  return { clause: `WHERE ${conditions.join(" AND ")}`, params };
}

function ratio(correct: number, graded: number): number | null {
  return graded > 0 ? Number((correct / graded).toFixed(4)) : null;
}

/**
 * Read-only aggregate report used by the Copilot-facing CLI.
 *
 * The session query is expanded with one joined row per attempt. `COUNT(DISTINCT s.id)`
 * and `s.question_count` are therefore summarised through a per-session CTE first,
 * avoiding the usual join multiplication of assigned question counts.
 */
export function buildPlatformUsageReport(
  database: DatabaseSync,
  filters: PlatformUsageFilters = {},
): PlatformUsageReport {
  const { clause, params } = whereClause(filters);
  const baseCte = `
    WITH session_stats AS (
      SELECT s.id,
             s.learner_id AS learnerId,
             s.topic_id AS topicId,
             s.mode,
             s.origin,
             s.question_count AS assignedQuestions,
             s.created_at AS createdAt,
             s.source_session_id AS sourceSessionId,
             COUNT(CASE WHEN trim(a.answer) <> '' THEN 1 END) AS answeredQuestions,
             COUNT(a.is_correct) AS gradedQuestions,
             COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct,
             COUNT(CASE WHEN a.is_correct = 0 THEN 1 END) AS wrong
      FROM practice_sessions s
      LEFT JOIN attempts a ON a.session_id = s.id
      ${clause}
      GROUP BY s.id
    ),
    identities AS (
      SELECT 'school:' || lower(email) AS learnerId,
             name, class_name AS className, student_number AS studentNumber,
             lower(email) AS email
      FROM roster_students
    )`;

  const overall = database
    .prepare(
      `${baseCte}
       SELECT COUNT(*) AS sessions,
              COUNT(DISTINCT learnerId) AS learners,
              COALESCE(SUM(assignedQuestions), 0) AS assignedQuestions,
              COALESCE(SUM(answeredQuestions), 0) AS answeredQuestions,
              COALESCE(SUM(gradedQuestions), 0) AS gradedQuestions,
              COALESCE(SUM(correct), 0) AS correct,
              COALESCE(SUM(wrong), 0) AS wrong
       FROM session_stats`,
    )
    .get(...params) as unknown as Omit<UsageTotal, "accuracy">;

  type RawGroup = GroupUsage & { gradedQuestions: number };
  const queryGroups = <T extends RawGroup>(groupSql: string, groupParams = params): T[] =>
    database
      .prepare(`${baseCte} ${groupSql}`)
      .all(...groupParams) as unknown as T[];

  const commonColumns = `COUNT(*) AS sessions,
                          COALESCE(SUM(assignedQuestions), 0) AS assignedQuestions,
                          COALESCE(SUM(answeredQuestions), 0) AS answeredQuestions,
                          COALESCE(SUM(gradedQuestions), 0) AS gradedQuestions,
                          COALESCE(SUM(correct), 0) AS correct,
                          COALESCE(SUM(wrong), 0) AS wrong`;

  const byMode = queryGroups<RawGroup & { mode: string }>(
    `SELECT mode, ${commonColumns}
     FROM session_stats GROUP BY mode ORDER BY mode`,
  );
  const modeLabels: Record<string, string> = {
    standard: "一般練習",
    "wrong-only": "重溫錯題",
  };

  const byOrigin = queryGroups<RawGroup & { origin: string }>(
    `SELECT origin, ${commonColumns}
     FROM session_stats WHERE mode = 'standard'
     GROUP BY origin ORDER BY origin`,
  );
  const originLabels: Record<string, string> = {
    bank: "題庫題目",
    generated: "AI 即時生成",
    demo: "內建示範",
  };

  const byClass = queryGroups<RawGroup & { className: string; learners: number }>(
    `SELECT COALESCE(i.className, '未列入名冊') AS className,
            COUNT(DISTINCT s.learnerId) AS learners,
            ${commonColumns.replaceAll("COUNT(*)", "COUNT(s.id)")}
     FROM session_stats s
     LEFT JOIN identities i ON i.learnerId = lower(s.learnerId)
     GROUP BY COALESCE(i.className, '未列入名冊')
     ORDER BY className`,
  );

  const byStudent = queryGroups<
    RawGroup & {
      learnerId: string;
      name: string | null;
      className: string | null;
      studentNumber: string | null;
      email: string | null;
      lastAt: string;
    }
  >(
    `SELECT s.learnerId, i.name, i.className, i.studentNumber, i.email,
            MAX(s.createdAt) AS lastAt, COUNT(*) AS sessions,
            ${commonColumns
              .split(",")
              .slice(1)
              .join(",")}
     FROM session_stats s
     LEFT JOIN identities i ON i.learnerId = lower(s.learnerId)
     GROUP BY s.learnerId
     ORDER BY COALESCE(i.className, 'ZZZ'), COALESCE(i.studentNumber, '999'), i.name`,
  );

  const byTopic = queryGroups<
    RawGroup & { topicId: string; topicTitle: string; learners: number }
  >(
    `SELECT s.topicId, COALESCE(t.title, s.topicId) AS topicTitle,
            COUNT(DISTINCT s.learnerId) AS learners, ${commonColumns.replaceAll("COUNT(*)", "COUNT(s.id)")}
     FROM session_stats s
     LEFT JOIN topics t ON t.id = s.topicId
     GROUP BY s.topicId
     ORDER BY topicTitle`,
  );

  const byDay = queryGroups<RawGroup & { day: string; learners: number }>(
    `SELECT substr(datetime(createdAt, '+8 hours'), 1, 10) AS day,
            COUNT(DISTINCT learnerId) AS learners, ${commonColumns}
     FROM session_stats
     GROUP BY day
     ORDER BY day`,
  );

  const reviewRow = database
    .prepare(
      `${baseCte},
       review_attempts AS (
         SELECT s.id AS reviewSessionId, r.id AS reviewAttemptId,
                r.is_correct AS reviewCorrect,
                s.sourceSessionId, s.learnerId, r.question_id,
                (SELECT 1
                   FROM attempts p
                  WHERE p.session_id = s.sourceSessionId
                    AND p.learner_id = s.learnerId
                    AND p.question_id = r.question_id
                    AND (p.is_correct = 0 OR p.self_assessment = 'needs-review'
                         OR p.ai_verdict = 'incorrect')
                  LIMIT 1) AS priorWrong
         FROM session_stats s
         JOIN attempts r ON r.session_id = s.id
        WHERE s.mode = 'wrong-only' AND trim(r.answer) <> ''
       )
       SELECT COUNT(DISTINCT ra.reviewSessionId) AS sessions,
              COUNT(*) AS answeredQuestions,
              COUNT(CASE WHEN ra.reviewCorrect = 1 THEN 1 END) AS correct,
              COUNT(CASE WHEN ra.priorWrong = 1 THEN 1 END) AS matchedPriorQuestions,
              COUNT(CASE WHEN ra.priorWrong = 1 AND ra.reviewCorrect = 1 THEN 1 END)
                AS improvedQuestions
       FROM review_attempts ra`,
    )
    .get(...params) as unknown as {
      sessions: number;
      answeredQuestions: number;
      correct: number;
      matchedPriorQuestions: number;
      improvedQuestions: number;
    };

  const rangeRow = database
    .prepare(
      `SELECT substr(datetime(MIN(created_at), '+8 hours'), 1, 10) AS minDate,
              substr(datetime(MAX(created_at), '+8 hours'), 1, 10) AS maxDate
       FROM practice_sessions
       WHERE learner_id NOT LIKE 'teacher:%'
         AND learner_id NOT LIKE 'admin:%'
         AND learner_id NOT LIKE 'e2e-%'`,
    )
    .get() as unknown as { minDate: string | null; maxDate: string | null };
  const rosterRow = database
    .prepare("SELECT MAX(updated_at) AS updatedAt FROM roster_students")
    .get() as unknown as { updatedAt: string | null };

  const withGroupAccuracy = <T extends RawGroup>(
    rows: T[],
  ): Array<Omit<T, "gradedQuestions"> & { accuracy: number | null }> =>
    rows.map(({ gradedQuestions, ...row }) => ({
      ...row,
      accuracy: ratio(row.correct, gradedQuestions),
    }));

  return {
    generatedAt: new Date().toISOString(),
    databaseRange: { from: rangeRow.minDate, to: rangeRow.maxDate },
    filters: { from: filters.from ?? null, to: filters.to ?? null, timeZone: "Asia/Hong_Kong" },
    rosterUpdatedAt: rosterRow.updatedAt,
    overall: { ...overall, accuracy: ratio(overall.correct, overall.gradedQuestions) },
    byMode: withGroupAccuracy(byMode).map((row, index) => ({
      ...row,
      mode: byMode[index]!.mode,
      label: modeLabels[byMode[index]!.mode] ?? byMode[index]!.mode,
    })),
    byOrigin: withGroupAccuracy(byOrigin).map((row, index) => ({
      ...row,
      origin: byOrigin[index]!.origin,
      label: originLabels[byOrigin[index]!.origin] ?? byOrigin[index]!.origin,
    })),
    byClass: withGroupAccuracy(byClass),
    byStudent: withGroupAccuracy(byStudent),
    byTopic: withGroupAccuracy(byTopic),
    byDay: withGroupAccuracy(byDay),
    reviewEffectiveness: {
      ...reviewRow,
      accuracy: ratio(reviewRow.correct, reviewRow.answeredQuestions),
      improvementRate: ratio(reviewRow.improvedQuestions, reviewRow.matchedPriorQuestions),
    },
  };
}
