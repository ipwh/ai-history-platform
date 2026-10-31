import { HISTORY_TERM_GROUPS, normalizeHistoryAnswer } from "@/lib/history-lexicon";
import type { TutorQuestionCandidate } from "@/lib/tutor-question-suggestions";
import type { TutorCurriculumIndex } from "@/server/services/tutor-grounding";

export const TUTOR_QUERY_CLARIFY_REPLY =
  "我未能確定你想問哪一件歷史事或哪個方向。請選擇以下一個問題，或自行改寫後再問：";

const NORMALIZATION_RULES: readonly [RegExp, string][] = [
  [/喺唔喺|係唔係|是不是/g, "是否"],
  [/點解/g, "為什麼"],
  [/係咩|系咩/g, "是什麼"],
  [/係咪|系咪/g, "是否"],
  // 先收斂「有冇」，再處理句中獨立的「冇」。
  [/有冇/g, "是否有"],
  [/冇/g, "沒有"],
  [/點樣/g, "如何"],
  [/點罰/g, "如何懲罰"],
  // 對齊本校教材的香港常用譯名。
  [/希特勒/g, "希特拉"],
  [/爆出嚟|爆出黎/g, "爆發"],
  [/爆出来/g, "爆發"],
  [/(第一次世界大戰|第二次世界大戰|一戰|二戰)會爆/g, "$1爆發"],
  [/改咗啲咩/g, "有什麼改變"],
  [/改了什么/g, "有什麼改變"],
  [/有咩分別/g, "有什麼分別"],
  [/咩分別/g, "什麼分別"],
  // 把帶出施事者的口語「俾…佔咗」轉成教材常見的被動表達。
  [/俾(日本|日軍|英國|英軍|德國|德軍)佔咗?/g, "被$1佔領"],
  [/邊個最勁/g, "哪一位最具影響"],
  [/俾人佔咗|俾人佔/g, "被佔領"],
  [/做咗乜/g, "做了什麼"],
  [/做了什么/g, "做了什麼"],
  [/啲學生/g, "學生"],
  [/講吓/g, "說明"],
  // 常見廣東話完成體及趨向補語，只做字面收斂。
  [/嚟/g, "來"],
  [/咗/g, "了"],
  [/嗰三個/g, "那三位"],
  [/嗰個/g, "那個"],
  [/嗰陣/g, "當時"],
  [/嗰堆/g, "那些"],
  [/喺/g, "在"],
  [/嘅/g, "的"],
];

const WEAK_HISTORY_SIGNALS = [
  "條約",
  "和約",
  "德國",
  "凡爾賽",
  "希特",
  "納粹",
  "法西斯",
  "藝術",
  "三個",
  "三位",
  "改革",
  "維新",
  "革命",
  "皇帝",
  "王朝",
  "戰爭",
  "戰後",
  "佔領",
  "後來",
  "之後",
  "嗰陣",
  "當時",
  "嗰個人",
  "歷史",
];

const CLARIFICATION_CATALOG = [
  {
    id: "versailles",
    label: "凡爾賽條約與戰後安排",
    triggers: ["條約", "和約", "德國", "凡爾賽", "1919", "戰後", "一戰"],
    requiredTerm: "凡爾賽條約",
    suggestedQuestion: "凡爾賽條約如何影響德國及戰後歐洲？",
  },
  {
    id: "ww1",
    label: "第一次世界大戰",
    triggers: ["一戰", "第一次世界大戰", "1919", "戰後"],
    requiredTerm: "第一次世界大戰",
    suggestedQuestion: "第一次世界大戰的起因如何影響戰後局勢？",
  },
  {
    id: "nanjing-treaty",
    label: "南京條約",
    triggers: ["條約", "和約"],
    requiredTerm: "南京條約",
    suggestedQuestion: "南京條約如何改變清政府與英國的關係？",
  },
  {
    id: "may-fourth",
    label: "五四運動",
    triggers: ["1919", "學生", "改革"],
    requiredTerm: "五四運動",
    suggestedQuestion: "五四運動如何反映當時中國社會的變化？",
  },
  {
    id: "renaissance",
    label: "文藝復興與藝術",
    triggers: ["藝術", "三個", "三位", "三傑", "文藝復興"],
    requiredTerm: "文藝復興",
    suggestedQuestion: "文藝復興的藝術如何反映當時的思想與文化？",
  },
  {
    id: "meiji",
    label: "明治維新",
    triggers: ["改革", "維新"],
    requiredTerm: "明治維新",
    suggestedQuestion: "明治維新回應了日本當時哪些歷史挑戰？",
  },
  {
    id: "cold-war",
    label: "冷戰與國際關係",
    triggers: ["冷戰", "德國", "後來", "之後"],
    requiredTerm: "冷戰",
    suggestedQuestion: "冷戰如何影響不同國家之間的關係？",
  },
] as const;

const EXPLICITLY_NON_HISTORY_PATTERNS = [
  /(?:python|javascript|typescript|程式碼|程式|編程|寫碼|code)/i,
  /天氣|氣溫|天氣預報/,
  /陪我(?:傾偈|傾計|聊天|傾談)|(?:傾偈|傾計|聊天)/,
  /數學|方程式|代數/,
];

function normalizedEnglishTerms(raw: string): string {
  // 接受常見全名、縮寫、大小寫及空格／連字號變體。
  return raw
    .replace(/\bworld\s+war\s+(?:1|i)\b/gi, "第一次世界大戰")
    .replace(/\bworld\s+war\s+(?:2|ii)\b/gi, "第二次世界大戰")
    .replace(/\bww[\s-]*1\b|\bwwi\b/gi, "第一次世界大戰")
    .replace(/\bww[\s-]*2\b|\bwwii\b/gi, "第二次世界大戰")
    .replace(/\bcold[\s-]+war\b/gi, "冷戰");
}

export function normalizeTutorQuery(raw: string): string {
  const simplifiedTraditional = normalizeHistoryAnswer(normalizedEnglishTerms(raw));
  return NORMALIZATION_RULES.reduce(
    (normalized, [pattern, replacement]) => normalized.replace(pattern, replacement),
    simplifiedTraditional,
  );
}

export function isClearlyNonHistoryTutorQuery(raw: string): boolean {
  const normalized = normalizeTutorQuery(raw);
  return EXPLICITLY_NON_HISTORY_PATTERNS.some(
    (pattern) => pattern.test(raw) || pattern.test(normalized),
  );
}

export function hasWeakHistorySignal(raw: string): boolean {
  const normalized = normalizeTutorQuery(raw);
  return (
    // 只把完整的短代詞回合視為待澄清訊號，不推測其指涉人物。
    /^(?:佢|佢哋|嗰個|嗰位)(?:呢|呀|咧|嗎|嘛)?[？?！!。…]*$/.test(normalized.trim()) ||
    /(?:公元前|公元|西元)?\d{1,4}(?:年|世紀|年代)|\b(?:1[0-9]{3}|20[0-2][0-9])\b/.test(
      normalized,
    ) ||
    WEAK_HISTORY_SIGNALS.some((signal) => normalized.includes(normalizeTutorQuery(signal))) ||
    HISTORY_TERM_GROUPS.some((group) =>
      [group.canonical, ...group.aliases].some((term) => {
        const key = normalizeTutorQuery(term);
        return key.length >= 2 && normalized.includes(key);
      }),
    )
  );
}

function hasSpecificHistoryAnchor(
  normalized: string,
  curriculum: TutorCurriculumIndex,
): boolean {
  const lexiconTerms = HISTORY_TERM_GROUPS.flatMap((group) => [
    group.canonical,
    ...group.aliases,
  ]);
  if (
    lexiconTerms.some((term) => {
      const key = normalizeTutorQuery(term);
      return key.length >= 2 && normalized.includes(key);
    })
  ) {
    return true;
  }

  for (const topic of curriculum.topics) {
    for (const section of curriculum.sectionsByTopic.get(topic.id) ?? []) {
      for (const term of [section.title, ...section.matchKeywords]) {
        const key = normalizeTutorQuery(term);
        if (key.length >= 2 && normalized.includes(key)) return true;
      }
    }
  }
  return false;
}

export function isUnclearTutorQuery(
  raw: string,
  curriculum: TutorCurriculumIndex,
  hasValidHistoryContext: boolean,
): boolean {
  if (hasValidHistoryContext || !hasWeakHistorySignal(raw)) return false;
  const normalized = normalizeTutorQuery(raw);
  if (
    /(?:嗰啲嘢|那些事情|那些東西|嗰堆|那些|係點|是怎樣|好慘|很慘|慘不慘|好唔好|好不好)/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (!hasSpecificHistoryAnchor(normalized, curriculum)) return true;
  return (
    normalized.length < 24 &&
    !/(?:為什麼|為何|如何|怎樣|成因|起因|背景|影響|特色|特點|內容|分別|誰|哪些|哪個|哪一|何時|幾時|哪裡|邊度|順序|改變|爆發|佔領|解釋|說明|方法|計算|甚麼|什麼|是否|一樣|做了|做過|做咩|做乜|乜|割|列出|整理|提示|抄)/.test(
      normalized,
    )
  );
}

function relevanceSignals(raw: string, context: string[]): string[] {
  const normalized = normalizeTutorQuery([raw, ...context].join(" "));
  const signals = new Set(
    WEAK_HISTORY_SIGNALS.filter((signal) =>
      normalized.includes(normalizeTutorQuery(signal)),
    ),
  );

  for (const group of HISTORY_TERM_GROUPS) {
    const terms = [group.canonical, ...group.aliases].map(normalizeTutorQuery);
    if (terms.some((term) => term.length >= 2 && normalized.includes(term))) {
      signals.add(group.canonical);
    }
  }

  if (normalized.includes("1919")) {
    signals.add("凡爾賽條約");
    signals.add("五四運動");
    signals.add("第一次世界大戰");
  }
  return [...signals];
}

function sectionQuestion(title: string): string {
  const subject = title
    .replace(/^(?:課題|單元)\s*\d+[：:：]?\s*/, "")
    .replace(/(?:的)?(?:內容|背景|影響|特點|發展)$/, "")
    .trim();
  if (/條約|和約|協定/.test(subject)) {
    return `${subject}如何影響當時的國際關係？`;
  }
  if (/藝術|文藝復興/.test(subject)) {
    return `${subject}如何反映當時的思想與文化？`;
  }
  if (/改革|維新/.test(subject)) {
    return `${subject}回應了當時哪些歷史挑戰？`;
  }
  return `${subject}的背景和影響有甚麼關係？`;
}

function candidateFromSection(
  topicId: string,
  sectionId: string,
  title: string,
  index: number,
): TutorQuestionCandidate {
  const label = title.trim().slice(0, 60);
  return {
    id: `section-${index + 1}-${topicId}-${sectionId}`,
    label,
    suggestedQuestion: sectionQuestion(label),
  };
}

export function buildClarifyCandidates(
  raw: string,
  context: string[],
  curriculum: TutorCurriculumIndex,
  preferredTopicId: string | null = null,
): TutorQuestionCandidate[] {
  const signals = relevanceSignals(raw, context);
  const signalKeys = signals.map(normalizeTutorQuery).filter((signal) => signal.length >= 2);
  const rankedSections = curriculum.topics.flatMap((topic) =>
    (curriculum.sectionsByTopic.get(topic.id) ?? []).map((section) => {
      const text = normalizeTutorQuery(
        [topic.title, section.title, ...section.matchKeywords].join(" "),
      );
      const score =
        (topic.id === preferredTopicId ? 20 : 0) +
        signalKeys.reduce((total, signal) => total + (text.includes(signal) ? signal.length : 0), 0);
      return { topic, section, score };
    }),
  );

  const candidates: TutorQuestionCandidate[] = [];
  const seenQuestions = new Set<string>();
  const add = (candidate: TutorQuestionCandidate) => {
    if (candidates.length >= 4 || seenQuestions.has(candidate.suggestedQuestion)) return;
    seenQuestions.add(candidate.suggestedQuestion);
    candidates.push(candidate);
  };

  rankedSections
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .forEach((entry, index) =>
      add(candidateFromSection(entry.topic.id, entry.section.id, entry.section.title, index)),
    );

  for (const entry of CLARIFICATION_CATALOG) {
    const termExists = HISTORY_TERM_GROUPS.some(
      (group) => group.canonical === entry.requiredTerm,
    );
    const matchesSignal =
      entry.triggers.some((trigger) =>
        signals.some((signal) => normalizeTutorQuery(signal).includes(normalizeTutorQuery(trigger))),
      ) || signalKeys.some((signal) => normalizeTutorQuery(entry.requiredTerm).includes(signal));
    if (termExists && matchesSignal) {
      add({
        id: entry.id,
        label: entry.label,
        suggestedQuestion: entry.suggestedQuestion,
      });
    }
  }

  if (candidates.length < 2) {
    for (const entry of CLARIFICATION_CATALOG) {
      if (!HISTORY_TERM_GROUPS.some((group) => group.canonical === entry.requiredTerm)) continue;
      add({
        id: entry.id,
        label: entry.label,
        suggestedQuestion: entry.suggestedQuestion,
      });
    }
  }

  return candidates.slice(0, 4);
}
