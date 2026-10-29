import { describe, expect, it } from "vite-plus/test";
import {
  buildProviderHandoffPrompt,
  PROVIDER_HANDOFF_DISCLAIMER,
  providerSwitchNeedsHandoff,
  redactHandoffSecrets,
} from "./providerHandoff";

describe("providerSwitchNeedsHandoff", () => {
  it("stays on the same account when the continuation folder matches", () => {
    expect(
      providerSwitchNeedsHandoff({
        locked: true,
        currentDriver: "claudeAgent",
        nextDriver: "claudeAgent",
        currentContinuationGroupKey: "claude:home:/Users/me/.claude",
        nextContinuationGroupKey: "claude:home:/Users/me/.claude",
      }),
    ).toBe(false);
  });

  it("asks for a handoff when the Claude folders differ", () => {
    expect(
      providerSwitchNeedsHandoff({
        locked: true,
        currentDriver: "claudeAgent",
        nextDriver: "claudeAgent",
        currentContinuationGroupKey: "claude:home:/Users/me/.claude",
        nextContinuationGroupKey: "claude:home:/Users/me/.claude_personal",
      }),
    ).toBe(true);
  });

  it("asks for a handoff when the provider driver changes", () => {
    expect(
      providerSwitchNeedsHandoff({
        locked: true,
        currentDriver: "claudeAgent",
        nextDriver: "codex",
        currentContinuationGroupKey: null,
        nextContinuationGroupKey: null,
      }),
    ).toBe(true);
  });

  it("does not hand off a draft that is not locked", () => {
    expect(
      providerSwitchNeedsHandoff({
        locked: false,
        currentDriver: "claudeAgent",
        nextDriver: "codex",
        currentContinuationGroupKey: "a",
        nextContinuationGroupKey: "b",
      }),
    ).toBe(false);
  });
});

describe("buildProviderHandoffPrompt", () => {
  it("keeps the latest request, names both accounts, and redacts secrets", () => {
    const prompt = buildProviderHandoffPrompt({
      sourceLabel: "Claude 200",
      targetLabel: "Claude 100",
      sourceTitle: "Fix the picker",
      messages: [
        { role: "reasoning", text: "secret chain of thought" },
        { role: "user", text: "Start the migration." },
        {
          role: "assistant",
          text: "The key is sk-ant-api03-supersecretvalue and the work is in apps/web.",
        },
        { role: "user", text: "Switch accounts and continue." },
      ],
    });

    expect(prompt).toContain(PROVIDER_HANDOFF_DISCLAIMER);
    expect(prompt).toContain("Claude 100");
    expect(prompt).toContain("Claude 200");
    expect(prompt).toContain("Fix the picker");
    expect(prompt).toContain("Switch accounts and continue.");
    expect(prompt).not.toContain("sk-ant-api03-supersecretvalue");
    expect(prompt).not.toContain("secret chain of thought");
    expect(prompt).toContain("[redacted]");
  });

  it("redacts a standalone token", () => {
    expect(redactHandoffSecrets("token sk-abcdefghijklmnopqrstuvwxyz")).toContain("[redacted]");
  });
});
