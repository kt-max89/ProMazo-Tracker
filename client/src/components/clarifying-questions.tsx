import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CornerDownLeft, Pencil } from "lucide-react";
import type { QuestionResponseInput, QuestionSet } from "@shared/clarifyingQuestion";

// Characters revealed per animation frame when a question "streams" in.
const CHARS_PER_TICK = 3;
const TICK_MS = 16;
// Brief highlight on a picked option before moving to the next question.
const ADVANCE_DELAY_MS = 180;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Reveals `text` a few characters at a time, like streamed agent output. */
function useStreamedText(text: string, animate: boolean): { shown: string; done: boolean } {
  // The count is tied to the text it was measured against, so switching to a
  // new question never flashes the old progress for a frame.
  const [state, setState] = useState({ text, count: animate ? 0 : text.length });
  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setState({ text, count: text.length });
      return;
    }
    setState({ text, count: 0 });
    const timer = setInterval(() => {
      setState(current => {
        const count = Math.min(text.length, current.count + CHARS_PER_TICK);
        if (count === text.length) clearInterval(timer);
        return { text, count };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [text, animate]);
  const count = state.text === text ? state.count : animate && !prefersReducedMotion() ? 0 : text.length;
  return { shown: text.slice(0, count), done: count >= text.length };
}

const bubbleClass = "bg-card border rounded-2xl rounded-bl-md px-4 py-3";

/**
 * The agent's clarifying questions, shown one at a time inside the chat as an
 * assistant bubble with an X/Y counter. Choices are a stacked list; the last
 * row is a "type your own answer" box. Picking a choice advances to the next
 * question, and answering the last one sends everything. Skipped questions
 * make the server tell the agent to guess conservatively and say so.
 */
export function ClarifyingQuestions({
  questionSet,
  active,
  disabled = false,
  onRespond,
  testIdPrefix,
}: {
  questionSet: QuestionSet;
  /** Only the latest message's questions are answerable; older ones show a recap. */
  active: boolean;
  /** True while a chat request is in flight; input is ignored until it ends. */
  disabled?: boolean;
  onRespond: (response: QuestionResponseInput) => void;
  testIdPrefix: string;
}) {
  const { questions } = questionSet;
  const total = questions.length;
  const [index, setIndex] = useState(0);
  // undefined = not reached yet, null = skipped, string = answer.
  const [answers, setAnswers] = useState<Array<string | null | undefined>>(() => questions.map(() => undefined));
  const [custom, setCustom] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const seen = useRef(new Set<number>());
  const cardRef = useRef<HTMLDivElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const question = questions[index];
  // Stream each question in only the first time it appears.
  const firstView = active && !submitted && !seen.current.has(index);
  const { shown, done } = useStreamedText(question.prompt, firstView);
  useEffect(() => {
    if (done) seen.current.add(index);
  }, [done, index]);

  // Restore a previous answer when the user goes back to a question.
  useEffect(() => {
    const previous = answers[index];
    const optionIndex = typeof previous === "string" ? question.options.indexOf(previous) : -1;
    setPicked(optionIndex >= 0 ? optionIndex : null);
    setCustom(typeof previous === "string" && optionIndex < 0 ? previous : "");
    // Keep keyboard focus on the card after moving between questions.
    if (index > 0 || seen.current.size > 0) cardRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function finish(final: Array<string | null | undefined>, skippedAll: boolean) {
    if (disabled || submitted) return;
    setSubmitted(true);
    onRespond({
      questionSetId: questionSet.questionSetId,
      skippedAll,
      answers: questions.map((q, i) => ({ prompt: q.prompt, answer: skippedAll ? null : final[i] ?? null })),
    });
  }

  function record(answer: string | null) {
    if (!active || submitted || disabled) return;
    const next = answers.map((value, i) => (i === index ? answer : value));
    setAnswers(next);
    if (index === total - 1) finish(next, false);
    else setIndex(index + 1);
  }

  function pick(optionIndex: number) {
    if (!active || submitted || disabled || (advanceTimer.current && picked !== null)) return;
    setPicked(optionIndex);
    setCustom("");
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = undefined;
      record(question.options[optionIndex]);
    }, prefersReducedMotion() ? 0 : ADVANCE_DELAY_MS);
  }

  // Number keys pick the matching choice, as in a CLI picker.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!active || submitted || (e.target as HTMLElement).tagName === "INPUT") return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }

  // Once answered (or bypassed by a typed message) the bubble becomes a recap.
  if (submitted || !active) {
    return (
      <div className={`${bubbleClass} space-y-2`} data-testid={`${testIdPrefix}-questions-summary`}>
        {questions.map((q, i) => {
          const answer = answers[i];
          return (
            <div key={i} className="text-sm">
              <p className="text-muted-foreground">{q.prompt}</p>
              <p className="font-medium flex items-center gap-1.5">
                {typeof answer === "string" ? (
                  <><Check className="w-3.5 h-3.5 text-primary shrink-0" />{answer}</>
                ) : (
                  <span className="text-muted-foreground font-normal italic">
                    {submitted ? "Skipped" : "Not answered"}
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  const nextNumber = question.options.length + 1;

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={`Question ${index + 1} of ${total}`}
      className={`${bubbleClass} w-[34rem] max-w-full outline-none animate-in fade-in slide-in-from-bottom-1 duration-300`}
      data-testid={`${testIdPrefix}-questions`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium min-w-0">
          {question.header && (
            <span className="mr-2 inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-normal align-middle">
              {question.header}
            </span>
          )}
          {/* Screen readers get the full prompt; sighted users see it stream. */}
          <span aria-hidden="true" data-testid={`${testIdPrefix}-question-prompt`}>{shown}</span>
          <span className="sr-only">{question.prompt}</span>
        </div>
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5"
          data-testid={`${testIdPrefix}-question-counter`}
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
          const selected = picked === oi;
          return (
            <li key={oi}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`${testIdPrefix}-question-option-${oi}`}
                onClick={() => pick(oi)}
                className={`w-full flex items-center gap-3 text-left text-sm text-foreground rounded-lg border px-3 py-2 transition-colors ${
                  selected ? "border-primary bg-primary/10" : "hover:bg-muted"
                }`}
              >
                <span className={`shrink-0 w-5 h-5 rounded text-[11px] flex items-center justify-center tabular-nums ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {oi + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">{option}</span>
                {oi === question.recommendedIndex && (
                  <span className="shrink-0 text-[11px] text-primary font-medium">Suggested</span>
                )}
              </button>
            </li>
          );
        })}
        <li>
          <form
            className="flex items-center gap-3 rounded-lg border px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring"
            onSubmit={e => {
              e.preventDefault();
              if (custom.trim()) record(custom.trim());
            }}
          >
            <span className="shrink-0 w-5 h-5 rounded bg-muted text-muted-foreground flex items-center justify-center">
              {question.options.length > 0
                ? <span className="text-[11px] tabular-nums">{nextNumber}</span>
                : <Pencil className="w-3 h-3" />}
            </span>
            <input
              data-testid={`${testIdPrefix}-question-custom`}
              value={custom}
              onChange={e => { setCustom(e.target.value); setPicked(null); }}
              maxLength={1000}
              placeholder={question.options.length > 0 ? "Type your own answer…" : "Type your answer…"}
              aria-label={`Your own answer to: ${question.prompt}`}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground py-0.5 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!custom.trim()}
              data-testid={`${testIdPrefix}-question-custom-submit`}
              aria-label="Send this answer"
              className="shrink-0 p-1 rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
          </form>
        </li>
      </ol>

      <div className={`mt-3 flex items-center gap-2 text-xs transition-opacity duration-200 ${done ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {index > 0 && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-question-back`}
            onClick={() => setIndex(index - 1)}
            className="flex items-center gap-1 px-2 py-1 rounded text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-testid={`${testIdPrefix}-question-skip`}
            onClick={() => record(null)}
            className="px-2 py-1 rounded text-muted-foreground hover:bg-muted"
          >
            Skip
          </button>
          {total > 1 && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-skip-all`}
              onClick={() => finish(answers, true)}
              className="px-2 py-1 rounded text-muted-foreground hover:bg-muted"
            >
              Skip all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
