import { useState } from "react";
import { decisionsMessage, type DecisionPicks } from "@t3tools/shared/toolOutput";
import { decisionsReady, type ActiveDecisions } from "./decisionsCard.logic";

export function useDecisions(active: ActiveDecisions | null | undefined, threadKey: string) {
  const key = `${threadKey}:${active?.id ?? ""}`;
  const [draft, setDraft] = useState<{ key: string; picks: DecisionPicks }>({
    key,
    picks: { answers: {}, next: [] },
  });
  if (draft.key !== key) setDraft({ key, picks: { answers: {}, next: [] } });
  const picks = draft.key === key ? draft.picks : { answers: {}, next: [] };
  return {
    picks,
    setPicks: (picks: DecisionPicks) => setDraft({ key, picks }),
    message: active ? decisionsMessage(active.decisions, picks) : "",
    ready: active ? decisionsReady(active.decisions, picks) : false,
  };
}
