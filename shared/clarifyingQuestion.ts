import { z } from "zod";

// The chat agent can end a turn by asking the user up to four clarifying
// questions. The client renders each one as up to four suggested answers plus
// a free-text "type your own answer" box (or only the free-text box when no
// options are given), with "Submit answers" and "Skip all" buttons.
//
// Answers travel back as a structured `questionResponse` on /api/chat. The
// server turns them into the user's chat message and, for anything skipped,
// tells the agent to make conservative guesses and say so explicitly.
export const MAX_QUESTIONS = 4;
export const MAX_QUESTION_OPTIONS = 4;
const MAX_PROMPT_CHARS = 300;
const MAX_HEADER_CHARS = 24;
const MAX_OPTION_CHARS = 120;
const MAX_ANSWER_CHARS = 1000;

export type ClarifyingQuestion = {
  prompt: string;
  /** Short chip label, e.g. "Project" or "Due date". */
  header?: string;
  /** Suggested answers, at most four. Empty means free text only. */
  options: string[];
  /** Index into `options` of the agent's best guess, if it has one. */
  recommendedIndex?: number;
};

export type QuestionSet = {
  questionSetId: string;
  questions: ClarifyingQuestion[];
};

const rawQuestionSchema = z.object({
  prompt: z.string(),
  header: z.string().optional(),
  options: z.array(z.unknown()).optional(),
  recommendedIndex: z.number().optional(),
});

function parseOneQuestion(raw: unknown): ClarifyingQuestion | null {
  const parsed = rawQuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const prompt = parsed.data.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return null;

  const seen = new Set<string>();
  const options: string[] = [];
  // Track where the model's recommended option lands after filtering.
  let recommendedIndex: number | undefined;
  (parsed.data.options ?? []).forEach((value, originalIndex) => {
    if (options.length === MAX_QUESTION_OPTIONS || typeof value !== "string") return;
    const option = value.trim().slice(0, MAX_OPTION_CHARS);
    const key = option.toLowerCase();
    if (!option || seen.has(key)) return;
    seen.add(key);
    if (originalIndex === parsed.data.recommendedIndex) recommendedIndex = options.length;
    options.push(option);
  });

  const header = parsed.data.header?.trim().slice(0, MAX_HEADER_CHARS) || undefined;
  return { prompt, header, options, recommendedIndex };
}

/**
 * Tolerant parser for the model's optional `questions` sidecar (a single
 * `question` object is accepted too). Unusable entries are dropped, duplicate
 * prompts removed, and the set capped at four. Returns null if nothing is left.
 */
export function parseQuestionSet(raw: { questions?: unknown; question?: unknown }, questionSetId: string): QuestionSet | null {
  const candidates = Array.isArray(raw.questions) ? raw.questions : raw.question !== undefined ? [raw.question] : [];
  const seen = new Set<string>();
  const questions: ClarifyingQuestion[] = [];
  for (const candidate of candidates) {
    const question = parseOneQuestion(candidate);
    if (!question || seen.has(question.prompt.toLowerCase())) continue;
    seen.add(question.prompt.toLowerCase());
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions.length > 0 ? { questionSetId, questions } : null;
}

/**
 * Markdown version of the questions. It is appended to the persisted assistant
 * message so the model sees what it asked on the next turn and reloaded
 * sessions still show the questions.
 */
export function questionSetAsMarkdown(set: QuestionSet): string {
  return set.questions.map((question, index) => {
    const lines = [`${index + 1}. **${question.prompt}**`];
    question.options.forEach((option, optionIndex) => {
      lines.push(`   - ${option}${optionIndex === question.recommendedIndex ? " (suggested)" : ""}`);
    });
    return lines.join("\n");
  }).join("\n");
}

// What the client sends back. `answer: null` means that question was skipped.
export const questionResponseSchema = z.object({
  questionSetId: z.string().min(1).max(100),
  skippedAll: z.boolean().default(false),
  answers: z.array(z.object({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
    answer: z.string().trim().max(MAX_ANSWER_CHARS).nullable(),
  })).min(1).max(MAX_QUESTIONS),
}).transform(response => ({
  ...response,
  // Blank answers count as skipped; Skip all overrides anything typed.
  answers: response.answers.map(entry => ({
    prompt: entry.prompt,
    answer: response.skippedAll || !entry.answer ? null : entry.answer,
  })),
}));

export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type QuestionResponseInput = z.input<typeof questionResponseSchema>;

export const SKIPPED_ANSWER_TEXT = "(skipped)";

/** The user's chat message for a question response, shown and persisted. */
export function formatQuestionResponse(response: QuestionResponse): string {
  const allSkipped = response.answers.every(entry => entry.answer === null);
  const heading = response.skippedAll || allSkipped
    ? "I skipped your questions. Please make conservative choices."
    : "Here are my answers:";
  const lines = response.answers.map((entry, index) =>
    `${index + 1}. ${entry.prompt} ${entry.answer ?? SKIPPED_ANSWER_TEXT}`);
  return [heading, ...lines].join("\n");
}

export function skippedQuestions(response: QuestionResponse): string[] {
  return response.answers.filter(entry => entry.answer === null).map(entry => entry.prompt);
}
