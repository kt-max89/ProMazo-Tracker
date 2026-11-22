import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQuestionResponse, parseQuestionSet, questionResponseSchema,
  questionSetAsMarkdown, skippedQuestions,
} from "../shared/clarifyingQuestion";
import { AGENT_APPLICATION_RULES, buildPrompt } from "../server/promptBuilder";

test("question sets are cleaned, capped at four questions and four options", () => {
  const set = parseQuestionSet({
    questions: [
      { header: "Project", prompt: " Which project? ", options: ["Alpha", " alpha ", "", 7, "Beta", "Gamma", "Delta", "Epsilon"], recommendedIndex: 4 },
      { prompt: "Which project?", options: ["dup prompt"] },
      { prompt: "   " },
      { prompt: "Due when?" },
      { prompt: "Q3?" }, { prompt: "Q4?" }, { prompt: "Q5?" },
    ],
  }, "set-1");
  assert.ok(set);
  assert.equal(set.questions.length, 4);
  const [first, second] = set.questions;
  assert.equal(first.prompt, "Which project?");
  assert.deepEqual(first.options, ["Alpha", "Beta", "Gamma", "Delta"]);
  // "Beta" was at raw index 4 and lands at index 1 after filtering.
  assert.equal(first.recommendedIndex, 1);
  assert.deepEqual(second, { prompt: "Due when?", header: undefined, options: [], recommendedIndex: undefined, correctIndex: undefined, explanation: undefined });
});

test("a single question object is accepted and junk yields null", () => {
  assert.equal(parseQuestionSet({ question: { prompt: "Which task?" } }, "x")?.questions.length, 1);
  assert.equal(parseQuestionSet({}, "x"), null);
  assert.equal(parseQuestionSet({ questions: [{ prompt: "" }, "nope", null] }, "x"), null);
});

test("markdown keeps the questions in history for the next turn", () => {
  const set = parseQuestionSet({ questions: [{ prompt: "Which?", options: ["A", "B"], recommendedIndex: 0 }] }, "s")!;
  assert.equal(questionSetAsMarkdown(set), "1. **Which?**\n   - A (suggested)\n   - B");
});

test("responses treat blanks as skipped and Skip all overrides typed answers", () => {
  const partial = questionResponseSchema.parse({
    questionSetId: "s",
    answers: [{ prompt: "Which project?", answer: "Alpha" }, { prompt: "Due when?", answer: "  " }],
  });
  assert.deepEqual(skippedQuestions(partial), ["Due when?"]);
  assert.equal(formatQuestionResponse(partial), "Here are my answers:\n1. Which project? Alpha\n2. Due when? (skipped)");

  const all = questionResponseSchema.parse({
    questionSetId: "s", skippedAll: true, answers: [{ prompt: "Which project?", answer: "Alpha" }],
  });
  assert.deepEqual(skippedQuestions(all), ["Which project?"]);
  assert.match(formatQuestionResponse(all), /^I skipped your questions/);

  assert.equal(questionResponseSchema.safeParse({ questionSetId: "s", answers: [] }).success, false);
});

test("a quiz set keeps correct answers and explanations and remaps correctIndex", () => {
  const set = parseQuestionSet({
    quiz: true,
    questions: [
      { prompt: "What does RAG stand for?", options: ["", "Retrieval-Augmented Generation", "Rapid Agent Gateway"], correctIndex: 1, explanation: " It retrieves, then generates. " },
    ],
  }, "quiz-1");
  assert.ok(set);
  assert.equal(set.isQuiz, true);
  const [first] = set.questions;
  assert.deepEqual(first.options, ["Retrieval-Augmented Generation", "Rapid Agent Gateway"]);
  // The empty option was dropped, so the raw index 1 lands at index 0.
  assert.equal(first.correctIndex, 0);
  assert.equal(first.explanation, "It retrieves, then generates.");
});

test("quiz questions without enough options or a valid correct answer are dropped", () => {
  assert.equal(parseQuestionSet({ quiz: true, questions: [{ prompt: "One choice?", options: ["only"], correctIndex: 0 }] }, "q"), null);
  assert.equal(parseQuestionSet({ quiz: true, questions: [{ prompt: "No answer?", options: ["A", "B"] }] }, "q"), null);
  // Without the quiz flag the same payload is a normal (non-quiz) question set.
  const plain = parseQuestionSet({ questions: [{ prompt: "Pick?", options: ["A", "B"], correctIndex: 0 }] }, "q");
  assert.equal(plain?.isQuiz, undefined);
});

test("quiz markdown marks the correct answer and quotes the explanation", () => {
  const set = parseQuestionSet({ quiz: true, questions: [{ prompt: "2+2?", options: ["3", "4"], correctIndex: 1, explanation: "Basic arithmetic." }] }, "q")!;
  assert.equal(questionSetAsMarkdown(set), "1. **2+2?**\n   - 3\n   - 4 (correct)\n   > Basic arithmetic.");
});

test("both agent contracts teach the question format; skips add a conservative-guess instruction", () => {
  assert.match(AGENT_APPLICATION_RULES.creation, /"questions"/);
  assert.match(AGENT_APPLICATION_RULES.editing, /"questions"/);
  // Both contracts also teach the quiz format.
  assert.match(AGENT_APPLICATION_RULES.creation, /"quiz": true/);
  assert.match(AGENT_APPLICATION_RULES.editing, /"quiz": true/);

  const plain = buildPrompt({ message: "Make a task" });
  assert.ok(!plain.some(m => m.role === "system" && String(m.content).includes("skipped these clarifying questions")));

  const skipped = buildPrompt({ message: "I skipped", skippedQuestions: ["Which project?"] });
  const note = skipped.find(m => m.role === "system" && String(m.content).includes("skipped these clarifying questions"));
  assert.ok(note);
  assert.match(String(note.content), /You didn't answer, so I guessed/);
  assert.match(String(note.content), /conservative/);
  // The instruction sits immediately before the user's message.
  assert.equal(skipped[skipped.length - 2], note);
});
