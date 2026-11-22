import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Trophy, X } from "lucide-react";
import type { QuestionSet } from "@shared/clarifyingQuestion";
import { bubbleClass, prefersReducedMotion, useStreamedText } from "./clarifying-questions";

// Brief highlight before the per-answer feedback settles in.
const REVEAL_DELAY_MS = 120;

/**
 * An agent-generated knowledge-check quiz, shown one question at a time inside
 * the chat as an assistant bubble with an X/Y counter. Picking an option locks
 * the answer and reveals whether it was correct (the correct choice and any
 * explanation are shown), then Next moves on. After the last question a results
 * screen shows the score and a per-question recap. Mirrors the clarifying
 * questions layout and keyboard shortcuts (number keys 1–N pick a choice).
 */
export function Quiz({
  questionSet,
  active,
  testIdPrefix,
}: {
  questionSet: QuestionSet;
  /** Only the latest message's quiz is interactive; older ones show the recap. */
  active: boolean;
  testIdPrefix: string;
}) {
  const { questions } = questionSet;
  const total = questions.length;
  const [index, setIndex] = useState(0);
  // undefined = not answered yet, number = the option the user chose.
  const [choices, setChoices] = useState<Array<number | undefined>>(() => questions.map(() => undefined));
  const [finished, setFinished] = useState(false);
  const seen = useRef(new Set<number>());
  const cardRef = useRef<HTMLDivElement>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(revealTimer.current), []);

  const question = questions[index];
  const chosen = choices[index];
  const revealed = chosen !== undefined;
  const score = questions.reduce((sum, q, i) => (choices[i] === q.correctIndex ? sum + 1 : sum), 0);
  const answered = choices.filter(choice => choice !== undefined).length;

  // Stream each question in only the first time it appears.
  const firstView = active && !finished && !revealed && !seen.current.has(index);
  const { shown, done } = useStreamedText(question.prompt, firstView);
  useEffect(() => {
    if (done) seen.current.add(index);
  }, [done, index]);

  useEffect(() => {
    // Keep keyboard focus on the card after moving between questions.
    if (index > 0 || seen.current.size > 0) cardRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function pick(optionIndex: number) {
    if (!active || finished || revealed) return;
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      setChoices(prev => prev.map((value, i) => (i === index ? optionIndex : value)));
    }, prefersReducedMotion() ? 0 : REVEAL_DELAY_MS);
  }

  function advance() {
    if (!active || finished || !revealed) return;
    if (index === total - 1) setFinished(true);
    else setIndex(index + 1);
  }

  // Number keys pick a choice (as in a CLI picker); Enter advances once answered.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!active || finished) return;
    if (e.key === "Enter" && revealed) {
      e.preventDefault();
      advance();
      return;
    }
    const n = Number(e.key);
    if (!revealed && Number.isInteger(n) && n >= 1 && n <= question.options.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }

  // Once finished (or when this is no longer the latest message) the bubble
  // becomes a results recap with the score and the correct answers.
  if (finished || !active) {
    return (
      <div className={`${bubbleClass} space-y-3 w-[34rem] max-w-full`} data-testid={`${testIdPrefix}-quiz-results`}>
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm font-medium" data-testid={`${testIdPrefix}-quiz-score`}>
            You got {score} of {total} correct
          </p>
        </div>
        <ol className="space-y-2">
          {questions.map((q, i) => {
            const choice = choices[i];
            const isCorrect = choice === q.correctIndex;
            return (
              <li key={i} className="text-sm" data-testid={`${testIdPrefix}-quiz-recap-${i}`}>
                <p className="text-muted-foreground flex items-start gap-1.5">
                  {choice === undefined ? (
                    <span className="text-muted-foreground font-normal italic shrink-0">Not answered —</span>
                  ) : isCorrect ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span className="min-w-0 break-words">{q.prompt}</span>
                </p>
                <p className="font-medium ml-5 break-words">{q.options[q.correctIndex!]}</p>
                {q.explanation && <p className="ml-5 text-xs text-muted-foreground break-words">{q.explanation}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={`Quiz question ${index + 1} of ${total}`}
      className={`${bubbleClass} w-[34rem] max-w-full outline-none animate-in fade-in slide-in-from-bottom-1 duration-300`}
      data-testid={`${testIdPrefix}-quiz`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium min-w-0">
          {question.header && (
            <span className="mr-2 inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-normal align-middle">
              {question.header}
            </span>
          )}
          {/* Screen readers get the full prompt; sighted users see it stream. */}
          <span aria-hidden="true" data-testid={`${testIdPrefix}-quiz-prompt`}>{shown}</span>
          <span className="sr-only">{question.prompt}</span>
        </div>
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5"
          data-testid={`${testIdPrefix}-quiz-counter`}
        >
          {index + 1}/{total}
        </span>
      </div>

      <ol
        key={index}
        role="radiogroup"
        aria-label={question.prompt}
        className={`mt-3 flex flex-col gap-1.5 transition-opacity duration-200 ${done ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        {question.options.map((option, oi) => {
          const isCorrect = oi === question.correctIndex;
          const isChosen = chosen === oi;
          let tone = "hover:bg-muted";
          let badgeTone = "bg-muted text-muted-foreground";
          if (revealed && isCorrect) {
            tone = "border-emerald-500 bg-emerald-500/10";
            badgeTone = "bg-emerald-500 text-white";
          } else if (revealed && isChosen) {
            tone = "border-red-500 bg-red-500/10";
            badgeTone = "bg-red-500 text-white";
          }
          return (
            <li key={oi}>
              <button
                type="button"
                role="radio"
                aria-checked={isChosen}
                disabled={revealed}
                data-testid={`${testIdPrefix}-quiz-option-${oi}`}
                onClick={() => pick(oi)}
                className={`w-full flex items-center gap-3 text-left text-sm text-foreground rounded-lg border px-3 py-2 transition-colors disabled:cursor-default ${tone}`}
              >
                <span className={`shrink-0 w-5 h-5 rounded text-[11px] flex items-center justify-center tabular-nums ${badgeTone}`}>
                  {oi + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">{option}</span>
                {revealed && isCorrect && <Check className="shrink-0 w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                {revealed && isChosen && !isCorrect && <X className="shrink-0 w-4 h-4 text-red-600 dark:text-red-400" />}
              </button>
            </li>
          );
        })}
      </ol>

      {revealed && (
        <div
          className="mt-3 text-xs rounded-lg bg-muted px-3 py-2"
          role="status"
          data-testid={`${testIdPrefix}-quiz-feedback`}
        >
          <p className={`font-medium ${chosen === question.correctIndex ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {chosen === question.correctIndex ? "Correct" : "Not quite"}
          </p>
          {chosen !== question.correctIndex && (
            <p className="mt-0.5 text-muted-foreground break-words">
              Correct answer: <span className="text-foreground font-medium">{question.options[question.correctIndex!]}</span>
            </p>
          )}
          {question.explanation && <p className="mt-0.5 text-muted-foreground break-words">{question.explanation}</p>}
        </div>
      )}

      <div className={`mt-3 flex items-center gap-2 text-xs transition-opacity duration-200 ${done ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {index > 0 && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-quiz-back`}
            onClick={() => setIndex(index - 1)}
            className="flex items-center gap-1 px-2 py-1 rounded text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        )}
        <span className="ml-auto text-muted-foreground tabular-nums" data-testid={`${testIdPrefix}-quiz-progress`}>
          {answered}/{total} answered
        </span>
        <button
          type="button"
          disabled={!revealed}
          data-testid={`${testIdPrefix}-quiz-next`}
          onClick={advance}
          className="flex items-center gap-1 px-2 py-1 rounded text-primary font-medium hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
        >
          {index === total - 1 ? "See results" : "Next"} <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
