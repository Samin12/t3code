import { useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { decisionsMessage, type Decisions, type DecisionPicks } from "@t3tools/shared/toolOutput";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { nextUnansweredAsk } from "./decisionsCard.logic";

export function DecisionsCard({
  decisions,
  picks,
  onChange,
  onSend,
  disabled = false,
  cwd,
  threadRef,
}: {
  readonly decisions: Decisions;
  readonly picks: DecisionPicks;
  readonly onChange: (picks: DecisionPicks) => void;
  readonly onSend: () => void;
  readonly disabled?: boolean;
  readonly cwd?: string | undefined;
  readonly threadRef: ScopedThreadRef;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [index, setIndex] = useState(0);
  const [custom, setCustom] = useState<Readonly<Record<number, boolean>>>({});
  const asks = decisions.asks ?? [];
  const ask = asks[index];
  const done = decisions.needs === "nothing";
  if (done && !decisions.next?.length) return null;
  const heading = done
    ? "Done"
    : asks.length > 0 && asks.every((ask) => ask.options?.length)
      ? "Decisions needed"
      : "Needs you";
  const answer = picks.answers[index] ?? "";
  const pick = (value: string, advance: boolean) => {
    const next = { ...picks, answers: { ...picks.answers, [index]: value } };
    onChange(next);
    if (advance) setIndex(nextUnansweredAsk(decisions, next, index));
  };
  return (
    <section
      aria-label={heading}
      className="mb-2 rounded-xl border border-border bg-card text-card-foreground"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 text-muted-foreground", collapsed && "-rotate-90")}
          />
          {heading}
          {decisions.headline ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {decisions.headline}
            </span>
          ) : null}
        </button>
        {!collapsed && asks.length > 1 ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous question"
              onClick={() => setIndex((index + asks.length - 1) % asks.length)}
            >
              <ChevronLeftIcon />
            </Button>
            <span>
              {index + 1} of {asks.length}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next question"
              onClick={() => setIndex((index + 1) % asks.length)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="space-y-2 px-3 pb-3">
          {done ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Or carry on</span>
              {decisions.next?.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "max-w-full rounded-full border px-2.5 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                    picks.next.includes(index)
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:bg-muted/50",
                  )}
                  aria-pressed={picks.next.includes(index)}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...picks,
                      next: picks.next.includes(index)
                        ? picks.next.filter((value) => value !== index)
                        : [...picks.next, index],
                    })
                  }
                >
                  {picks.next.includes(index) ? "✓ " : ""}
                  {item}
                </button>
              ))}
            </div>
          ) : ask ? (
            <>
              <p className="text-sm">{ask.question}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ask.options?.map((option, optionIndex) => (
                  <button
                    key={`${ask.question}:${option.label}`}
                    type="button"
                    aria-pressed={!custom[index] && answer === option.label}
                    disabled={disabled}
                    onClick={() => {
                      setCustom({ ...custom, [index]: false });
                      pick(option.label, true);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                      !custom[index] && answer === option.label
                        ? "border-primary/50 bg-primary/10"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                    {ask.suggested === optionIndex ? (
                      <span className="ms-2 text-2xs text-muted-foreground">Suggested</span>
                    ) : null}
                    {option.does ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.does}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {ask.links?.length ? (
                <div className="flex flex-wrap gap-2">
                  {ask.links.map((link) => (
                    <ChatMarkdown
                      key={`${link.title}:${link.url}`}
                      text={`[${link.title.replace(/[[\]\\]/g, "\\$&")}](<${link.url.replace(/ /g, "%20").replace(/>/g, "%3E")}>)`}
                      cwd={cwd}
                      threadRef={threadRef}
                      className="rounded-md border border-border px-2 py-1 text-xs"
                    />
                  ))}
                </div>
              ) : null}
              {ask.options?.length ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={custom[index] === true}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (!custom[index]) {
                      setCustom({ ...custom, [index]: true });
                      pick("", false);
                    }
                  }}
                >
                  Something else
                </button>
              ) : null}
              {custom[index] || !ask.options?.length ? (
                <div className="flex items-start gap-2">
                  <textarea
                    aria-label={`Answer: ${ask.question}`}
                    value={answer}
                    disabled={disabled}
                    rows={2}
                    onChange={(event) => pick(event.target.value, false)}
                    // Return moves on to the next unanswered ask, and sends once each has one;
                    // Shift-Return adds a line.
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                        return;
                      event.preventDefault();
                      if (!answer.trim()) return;
                      const nextIndex = nextUnansweredAsk(decisions, picks, index);
                      if (nextIndex !== index) setIndex(nextIndex);
                      else onSend();
                    }}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                  {asks.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!answer.trim()}
                      onClick={() => setIndex(nextUnansweredAsk(decisions, picks, index))}
                    >
                      Next
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Reply below when ready.</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={disabled || !decisionsMessage(decisions, picks)}
              onClick={onSend}
            >
              Send
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
