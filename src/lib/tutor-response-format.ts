export interface TutorResponseSections {
  content: string;
  coreKnowledge: string | null;
  selfCheckQuestion: string | null;
}

function extractSingleLineSection(
  content: string,
  marker: string,
  maxLength: number,
): { content: string; value: string | null } {
  const lines = content.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  if (markerIndex < 0) return { content, value: null };

  const value = lines[markerIndex + 1]?.trim() ?? "";
  const followingLine = lines[markerIndex + 2]?.trim();
  if (
    value.length === 0 ||
    value.length > maxLength ||
    (followingLine !== undefined && followingLine.length > 0)
  ) {
    return { content, value: null };
  }

  const start = markerIndex > 0 && lines[markerIndex - 1]?.trim() === ""
    ? markerIndex - 1
    : markerIndex;
  const end = followingLine === "" ? markerIndex + 3 : markerIndex + 2;
  return {
    content: [...lines.slice(0, start), ...lines.slice(end)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    value,
  };
}

/** Extracts the two explicitly marked learning blocks while preserving unmarked answers. */
export function parseTutorResponseSections(content: string): TutorResponseSections {
  const selfCheck = extractSingleLineSection(content, "【自我檢查題】", 240);
  const coreKnowledge = extractSingleLineSection(
    selfCheck.content,
    "【核心知識】",
    600,
  );
  return {
    content: coreKnowledge.content,
    coreKnowledge: coreKnowledge.value,
    selfCheckQuestion: selfCheck.value,
  };
}

export function buildTutorSelfCheckSubmission(question: string, answer: string): string {
  const trimmedQuestion = question.trim();
  const trimmedAnswer = answer.trim();
  if (trimmedQuestion.length === 0 || trimmedAnswer.length === 0) return "";

  return [
    "【自我檢查作答】",
    `題目：${trimmedQuestion}`,
    `我的答案：${trimmedAnswer}`,
    "",
    "請按本對話可見的教材依據，給我形成性回饋：指出一項答得準確的重點、一項仍需補充或修正之處，以及一個下一步提示。若教材不足以判斷，請明確說明。不要給分數或完整標準答案。",
  ].join("\n");
}
