import { describe, expect, it } from "vite-plus/test";
import {
  activeDecisionsForThread,
  decisionsEnterAction,
  decisionsReady,
  nextUnansweredAsk,
  prependDecisions,
} from "./decisionsCard.logic";

const decisions = {
  needs: "you",
  asks: [{ question: "Ship?", options: [{ label: "Yes" }] }, { question: "Where?" }],
} as const;
const call = (id: string, runId = "run", output: unknown = { decisions }) => ({
  item: {
    id,
    runId,
    type: "dynamic_tool",
    status: "completed",
    toolName: "t3-code.end_turn",
    output,
  },
});
const base = { latestRunId: "run", settled: true, hasOptimisticUserMessage: false };

describe("decisions composer", () => {
  it("uses the last successful card in the latest settled turn and retires it after user input", () => {
    const first = call("first");
    const second = call("second");
    expect(activeDecisionsForThread({ ...base, items: [first, second] })?.id).toBe("second");
    expect(
      activeDecisionsForThread({
        ...base,
        items: [first, call("failed", "run", { isError: true, decisions })],
      })?.id,
    ).toBe("first");
    expect(activeDecisionsForThread({ ...base, items: [first], latestRunId: "new" })).toBeNull();
    expect(activeDecisionsForThread({ ...base, items: [first], settled: false })).toBeNull();
    expect(
      activeDecisionsForThread({ ...base, items: [first], hasOptimisticUserMessage: true }),
    ).toBeNull();
    expect(
      activeDecisionsForThread({
        ...base,
        items: [first, { item: { id: "user", runId: null, type: "user_message" } }],
      }),
    ).toBeNull();
  });

  it("advances to unanswered questions and sends picks before typed text without requiring all answers", () => {
    const partial = { answers: { 0: "Yes" }, next: [] };
    expect(nextUnansweredAsk(decisions, partial, 0)).toBe(1);
    expect(decisionsReady(decisions, partial)).toBe(false);
    const complete = { answers: { 0: "Yes", 1: "Staging" }, next: [] };
    expect(decisionsReady(decisions, complete)).toBe(true);
    expect(nextUnansweredAsk(decisions, complete, 1)).toBe(1);
    expect(prependDecisions("Ship? → Yes", "With logs")).toBe("Ship? → Yes\n\nWith logs");
    expect(prependDecisions("Ship? → Yes", " ")).toBe("Ship? → Yes");
    expect(prependDecisions("", "Ordinary message")).toBe("Ordinary message");
    expect(
      decisionsReady({ needs: "nothing", next: ["Add tests"] }, { answers: {}, next: [0] }),
    ).toBe(true);
  });
});

it("sends complete picks on Return, permits partial picks on command-Return, and preserves ordinary editor keys", () => {
  const key = {
    key: "Enter",
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    repeat: false,
    prompt: "",
    message: "Ship? → Yes",
    ready: false,
  };
  expect(decisionsEnterAction(key)).toBe("wait");
  expect(decisionsEnterAction({ ...key, ready: true })).toBe("send");
  expect(decisionsEnterAction({ ...key, metaKey: true })).toBe("send");
  expect(decisionsEnterAction({ ...key, ctrlKey: true })).toBe("send");
  for (const override of [
    { prompt: "Typed message" },
    { message: "" },
    { shiftKey: true },
    { altKey: true },
    { isComposing: true },
    { repeat: true },
  ]) {
    expect(decisionsEnterAction({ ...key, ...override })).toBeNull();
  }
});
