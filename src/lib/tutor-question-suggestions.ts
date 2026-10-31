const SUGGESTION_HEADING = "【可選提問方向】";
const SUGGESTION_LINE = /^\s*(?:\d{1,2}[.．、)]|[一二三][、.．])\s*(.+?)\s*$/;

export interface TutorQuestionCandidate {
  id: string;
  label: string;
  suggestedQuestion: string;
}

export interface ParsedTutorQuestionSuggestions {
  content: string;
  suggestions: string[];
}

/**
 * Extracts clearly marked follow-up questions while keeping the saved transcript readable.
 * Suggestions are only shortcuts: the student still reviews and submits each question.
 */
export function parseTutorQuestionSuggestions(content: string): ParsedTutorQuestionSuggestions {
  const headingIndex = content.indexOf(SUGGESTION_HEADING);
  if (headingIndex < 0) return { content, suggestions: [] };

  const lines = content.slice(headingIndex + SUGGESTION_HEADING.length).split(/\r?\n/);
  let lineIndex = 0;
  while (lineIndex < lines.length && lines[lineIndex]?.trim().length === 0) lineIndex += 1;

  const suggestions: string[] = [];
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";
    const match = SUGGESTION_LINE.exec(line);
    if (!match) break;
    const question = (match[1] ?? "").replace(/^\*+|\*+$/g, "").trim();
    if (question.length >= 4 && question.length <= 180) suggestions.push(question);
    lineIndex += 1;
  }

  if (suggestions.length < 2) return { content, suggestions: [] };

  const before = content.slice(0, headingIndex).trimEnd();
  const after = lines.slice(lineIndex).join("\n").trim();
  return {
    content: [before, after].filter((part) => part.length > 0).join("\n"),
    suggestions: suggestions.slice(0, 3),
  };
}
