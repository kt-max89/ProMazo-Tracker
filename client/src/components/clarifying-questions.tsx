import { useState } from "react";
import { HelpCircle, Send, SkipForward } from "lucide-react";
import type { QuestionResponseInput, QuestionSet } from "@shared/clarifyingQuestion";

// One answer slot per question: either a picked suggestion or typed text.
type Draft = { selected: number | null; custom: string };

function answerFor(draft: Draft, options: string[]): string | null {
  if (draft.custom.trim()) return draft.custom.trim();
  return draft.selected === null ? null : options[draft.selected] ?? null;
}

/**
 * Renders the agent's clarifying questions: up to four suggested answers per
 * question plus a "type your own answer" box, with Submit and Skip all.
 * Unanswered questions are sent as skipped; the server then tells the agent
 * to make conservative guesses and explain them.
 */
export function ClarifyingQuestions({
  questionSet,
  active,
  onRespond,
  testIdPrefix,
}: {
  questionSet: QuestionSet;
  /** Only the latest assistant message's questions accept input. */
  active: boolean;
  onRespond: (response: QuestionResponseInput) => void;
  testIdPrefix: string;
}) {
  const { questions } = questionSet;
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ selected: null, custom: "" })));
  const answeredCount = drafts.filter((draft, i) => answerFor(draft, questions[i].options) !== null).length;

  function update(index: number, change: Partial<Draft>) {
    setDrafts(previous => previous.map((draft, i) => (i === index ? { ...draft, ...change } : draft)));
  }

  function respond(skippedAll: boolean) {
    if (!active) return;
    onRespond({
      questionSetId: questionSet.questionSetId,
      skippedAll,
      answers: questions.map((question, i) => ({
        prompt: question.prompt,
        answer: skippedAll ? null : answerFor(drafts[i], question.options),
      })),
    });
  }

  return (
    <div
      className={`border rounded-2xl px-4 py-3 space-y-4 bg-card ${active ? "" : "opacity-60"}`}
      data-testid={`${testIdPrefix}-questions`}
      aria-disabled={!active}
    >
      {questions.map((question, qi) => {
        const draft = drafts[qi];
        const groupLabel = `${testIdPrefix}-question-${qi}`;
        return (
          <fieldset key={qi} className="space-y-2" disabled={!active}>
            <legend className="text-sm font-medium flex items-start gap-2">
              <HelpCircle className="w-4 h-4 mt-0.5 text-primary shrink-0" />
              <span>
                {question.header && (
                  <span className="mr-2 inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-normal align-middle">
                    {question.header}
                  </span>
                )}
                {question.prompt}
              </span>
            </legend>
            {question.options.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={question.prompt}>
                {question.options.map((option, oi) => {
                  const selected = draft.selected === oi && !draft.custom.trim();
                  return (
                    <button
                      key={oi}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`${groupLabel}-option-${oi}`}
                      // Clicking the picked option again clears it; picking
                      // clears any typed answer so only one answer is sent.
                      onClick={() => update(qi, { selected: selected ? null : oi, custom: "" })}
                      className={`text-left text-sm text-foreground rounded-lg border px-3 py-2 transition-colors disabled:cursor-not-allowed ${
                        selected ? "border-primary bg-primary/10" : "hover:bg-muted"
                      }`}
                    >
                      {option}
                      {oi === question.recommendedIndex && (
                        <span className="ml-2 text-[11px] text-primary font-medium">Suggested</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              data-testid={`${groupLabel}-custom`}
              value={draft.custom}
              onChange={e => update(qi, { custom: e.target.value })}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  respond(false);
                }
              }}
              maxLength={1000}
              placeholder={question.options.length > 0 ? "Or type your own answer…" : "Type your answer…"}
              aria-label={`Your own answer to: ${question.prompt}`}
              className="w-full text-sm text-foreground border border-input rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </fieldset>
        );
      })}
      {active && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {questions.length > 1 && `${answeredCount} of ${questions.length} answered. `}
            Unanswered questions are skipped, and I'll make conservative guesses.
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              data-testid={`${testIdPrefix}-skip-all`}
              onClick={() => respond(true)}
              className="px-3 py-1.5 text-sm text-foreground rounded-lg border hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <SkipForward className="w-3.5 h-3.5" /> Skip all
            </button>
            <button
              type="button"
              data-testid={`${testIdPrefix}-submit`}
              onClick={() => respond(false)}
              disabled={answeredCount === 0}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Submit answers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
