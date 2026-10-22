/**
 * 練習統計的顯示規則（學生端與教師端共用）。
 *
 * 學習進度（見 src/server/services/learning-loop.ts）只計算題庫內已發布的題目，
 * 因此學生只練習 AI 即時生成的題目時，「題庫進度」會是 0。若介面單憑題庫進度判斷，
 * 已作答的學生便會看到「尚未開始」及「—」，令人誤以為沒有記錄。
 * 「練習累計答題」及「答對比率」一律以練習記錄的全部作答計算。
 */
import {
  CURRICULUM_THEME_LABELS,
  LEARNING_STATE_LABELS,
  SENIOR_SECONDARY_LEVEL,
  type CurriculumTheme,
  type LearningState,
} from "./types";

export interface PracticeTotals {
  answeredQuestions: number;
  correctAnswers: number;
}

/** 練習累計答對比率（0-100，四捨五入）；完全沒有作答時為 null */
export function practiceAccuracy(totals: PracticeTotals[]): number | null {
  const answered = totals.reduce((sum, item) => sum + Math.max(0, item.answeredQuestions), 0);
  if (answered === 0) return null;
  const correct = totals.reduce((sum, item) => sum + Math.max(0, item.correctAnswers), 0);
  return Math.round((correct / answered) * 100);
}

export type TopicBadgeTone = "muted" | "accent" | "success" | "warning";

export interface TopicBadge {
  label: string;
  tone: TopicBadgeTone;
  /** 供 title 屬性使用的說明，解釋這個狀態代表甚麼 */
  hint: string;
}

/**
 * 課題卡的狀態標示。
 *
 * 已作答（包括 AI 即時生成及重做的題目）但題庫進度仍是 0 時顯示「練習中」，
 * 避免把已開始練習的學生標示為「尚未開始」。
 */
export function topicBadge(state: LearningState, practicedAnswers: number): TopicBadge {
  if (state === "not-started") {
    return practicedAnswers > 0
      ? {
          label: "練習中",
          tone: "accent",
          hint: "已開始練習。題庫進度只計算題庫內已發布的題目，AI 即時生成的題目不會列入題庫進度。",
        }
      : {
          label: LEARNING_STATE_LABELS["not-started"],
          tone: "muted",
          hint: "未作答過題庫內已發布的題目。",
        };
  }
  if (state === "needs-review") {
    return {
      label: LEARNING_STATE_LABELS[state],
      tone: "warning",
      hint: "最近一次作答有答錯或未能確定的題目，建議先重溫。",
    };
  }
  return {
    label: LEARNING_STATE_LABELS[state],
    tone: "success",
    hint:
      state === "repeatedly-demonstrated"
        ? "題庫內至少 2 條不同題目最新一次作答為正確。"
        : "已作答題庫內已發布的題目，尚未達到掌握門檻。",
  };
}

/**
 * 課題的顯示名稱。
 * 高中課題的編號與初中重複（例如同為「課題1」），因此在教師端加上「高中・主題甲／乙」，
 * 避免同一份記錄清單出現兩個無法分辨的「課題1」。
 */
export function practiceTopicLabel(topic: {
  title: string;
  level: number;
  curriculumTheme: CurriculumTheme | null;
}): string {
  if (topic.level === SENIOR_SECONDARY_LEVEL && topic.curriculumTheme) {
    return `高中・${CURRICULUM_THEME_LABELS[topic.curriculumTheme]}｜${topic.title}`;
  }
  return topic.title;
}

/** 教師端「答對比率」欄位的文字 */
export function learnerAccuracyLabel(learner: {
  answeredQuestions: number;
  accuracy: number | null;
}): string {
  if (learner.answeredQuestions === 0) return "未作答";
  if (learner.accuracy === null) return "未評分";
  return `${Math.round(learner.accuracy * 100)}%`;
}
