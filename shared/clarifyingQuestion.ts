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
// A knowledge-check question needs at least two choices to be meaningful.
export const MIN_QUIZ_OPTIONS = 2;
const MAX_PROMPT_CHARS = 300;
const MAX_HEADER_CHARS = 24;
const MAX_OPTION_CHARS = 120;
const MAX_EXPLANATION_CHARS = 400;
const MAX_ANSWER_CHARS = 1000;

export type ClarifyingQuestion = {
  prompt: string;
  /** Short chip label, e.g. "Project" or "Due date". */
  header?: string;
  /** Suggested answers, at most four. Empty means free text only. */
  options: string[];
  /** Index into `options` of the agent's best guess, if it has one. */
  recommendedIndex?: number;
  /** Quiz sets only: index into `options` of the correct answer. */
  correctIndex?: number;
  /** Quiz sets only: why the correct answer is right, revealed after answering. */
  explanation?: string;
};

export type QuestionSet = {
  questionSetId: string;
  questions: ClarifyingQuestion[];
  /** True when this set is a knowledge-check quiz with correct answers. */
  isQuiz?: boolean;
};

const rawQuestionSchema = z.object({
  prompt: z.string(),
  header: z.string().optional(),
  options: z.array(z.unknown()).optional(),
  recommendedIndex: z.number().optional(),
  correctIndex: z.number().optional(),
  explanation: z.string().optional(),
});

function parseOneQuestion(raw: unknown, isQuiz: boolean): ClarifyingQuestion | null {
  const parsed = rawQuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const prompt = parsed.data.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return null;

  const seen = new Set<string>();
  const options: string[] = [];
  // Track where the recommended/correct options land after filtering.
  let recommendedIndex: number | undefined;
  let correctIndex: number | undefined;
  (parsed.data.options ?? []).forEach((value, originalIndex) => {
    if (options.length === MAX_QUESTION_OPTIONS || typeof value !== "string") return;
    const option = value.trim().slice(0, MAX_OPTION_CHARS);
    const key = option.toLowerCase();
    if (!option || seen.has(key)) return;
    seen.add(key);
    if (originalIndex === parsed.data.recommendedIndex) recommendedIndex = options.length;
    if (originalIndex === parsed.data.correctIndex) correctIndex = options.length;
    options.push(option);
  });

  // A quiz question is only usable with enough choices and a known answer.
  if (isQuiz && (options.length < MIN_QUIZ_OPTIONS || correctIndex === undefined)) return null;

  const header = parsed.data.header?.trim().slice(0, MAX_HEADER_CHARS) || undefined;
  const explanation = isQuiz ? parsed.data.explanation?.trim().slice(0, MAX_EXPLANATION_CHARS) || undefined : undefined;
  return { prompt, header, options, recommendedIndex, correctIndex, explanation };
}

/**
 * Tolerant parser for the model's optional `questions` sidecar (a single
 * `question` object is accepted too). Unusable entries are dropped, duplicate
 * prompts removed, and the set capped at four. Returns null if nothing is left.
 * A truthy `quiz` flag marks the set as a knowledge-check quiz, in which case
 * every question must carry at least two options and a valid `correctIndex`.
 */
export function parseQuestionSet(raw: { questions?: unknown; question?: unknown; quiz?: unknown }, questionSetId: string): QuestionSet | null {
  const isQuiz = raw.quiz === true;
  const candidates = Array.isArray(raw.questions) ? raw.questions : raw.question !== undefined ? [raw.question] : [];
  const seen = new Set<string>();
  const questions: ClarifyingQuestion[] = [];
  for (const candidate of candidates) {
    const question = parseOneQuestion(candidate, isQuiz);
    if (!question || seen.has(question.prompt.toLowerCase())) continue;
    seen.add(question.prompt.toLowerCase());
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  if (questions.length === 0) return null;
  return isQuiz ? { questionSetId, questions, isQuiz: true } : { questionSetId, questions };
}

/**
 * Markdown version of the questions. It is appended to the persisted assistant
 * message so the model sees what it asked on the next turn and reloaded
 * sessions still show the questions. For a quiz the correct answer is marked and
 * any explanation is quoted beneath the choices.
 */
export function questionSetAsMarkdown(set: QuestionSet): string {
  return set.questions.map((question, index) => {
    const lines = [`${index + 1}. **${question.prompt}**`];
    question.options.forEach((option, optionIndex) => {
      const marker = set.isQuiz
        ? optionIndex === question.correctIndex ? " (correct)" : ""
        : optionIndex === question.recommendedIndex ? " (suggested)" : "";
      lines.push(`   - ${option}${marker}`);
    });
    if (set.isQuiz && question.explanation) lines.push(`   > ${question.explanation}`);
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
