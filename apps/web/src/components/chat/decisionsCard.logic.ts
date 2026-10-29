import {
  decisionsFromToolItem,
  decisionsMessage,
  type Decisions,
  type DecisionPicks,
} from "@t3tools/shared/toolOutput";

export interface ActiveDecisions {
  readonly id: string;
  readonly decisions: Decisions;
}

export function activeDecisionsForThread(input: {
  readonly items: ReadonlyArray<{
    readonly item: {
      readonly id: string;
      readonly runId: string | null;
      readonly type: string;
      readonly status?: string;
      readonly toolName?: string | null;
      readonly output?: unknown;
    };
  }>;
  readonly latestRunId: string | null;
  readonly settled: boolean;
  readonly hasOptimisticUserMessage: boolean;
}): ActiveDecisions | null {
  if (!input.settled || input.latestRunId === null || input.hasOptimisticUserMessage) return null;
  for (let i = input.items.length - 1; i >= 0; i--) {
    const item = input.items[i]!.item;
    if (item.type === "user_message") return null;
    if (item.runId !== input.latestRunId || item.type !== "dynamic_tool") continue;
    const decisions = decisionsFromToolItem({ toolName: item.toolName, output: item.output });
    if (item.status === "completed" && decisions) return { id: item.id, decisions };
  }
  return null;
}

export function nextUnansweredAsk(
  decisions: Decisions,
  picks: DecisionPicks,
  current: number,
): number {
  const asks = decisions.asks ?? [];
  for (let step = 1; step <= asks.length; step++) {
    const index = (current + step) % asks.length;
    if (!picks.answers[index]?.trim()) return index;
  }
  return current;
}

export function decisionsReady(decisions: Decisions, picks: DecisionPicks): boolean {
  return decisions.needs === "nothing"
    ? decisionsMessage(decisions, picks).length > 0
    : Boolean(decisions.asks?.length) &&
        decisions.asks!.every((_, index) => Boolean(picks.answers[index]?.trim()));
}

export function prependDecisions(message: string, prompt: string): string {
  return message ? `${message}${prompt.trim() ? `\n\n${prompt}` : ""}` : prompt;
}

export function decisionsEnterAction(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly repeat: boolean;
  readonly prompt: string;
  readonly message: string;
  readonly ready: boolean;
}): "send" | "wait" | null {
  if (
    input.key !== "Enter" ||
    input.shiftKey ||
    input.altKey ||
    input.isComposing ||
    input.repeat ||
    input.prompt.trim() ||
    !input.message
  )
    return null;
  return input.ready || input.metaKey || input.ctrlKey ? "send" : "wait";
}
