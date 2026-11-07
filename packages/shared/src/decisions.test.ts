import { describe, expect, it } from "vite-plus/test";
import { decisionsMessage, normalizeDecisions } from "./decisions.ts";
import { compactDynamicToolOutput, decisionsFromToolItem } from "./toolOutput.ts";

describe("decisions", () => {
  it("normalizes asks, bounds text and counts, and rejects unsafe links and suggestions", () => {
    const decisions = normalizeDecisions({
      headline: "h".repeat(100),
      asks: [
        { question: " " },
        ...Array.from({ length: 12 }, () => ({
          question: "q".repeat(200),
          options: [
            { label: "one two three four five", does: "d".repeat(100) },
            ...Array.from({ length: 8 }, () => ({ label: "Yes" })),
          ],
          suggested: 8,
          links: [
            "javascript:alert(1)",
            "http://example.com",
            "//example.com",
            "https://example.com",
            "/tmp/a file",
            "~/Desktop/a",
          ].map((url) => ({ title: "Open", url })),
        })),
      ],
      next: ["Ignored"],
    })!;
    expect(decisions.headline).toHaveLength(80);
    expect(decisions.needs).toBe("you");
    expect(decisions.asks).toHaveLength(10);
    expect(decisions.asks?.[0]).toEqual({
      question: "q".repeat(160),
      options: [
        { label: "one two three four five", does: "d".repeat(90) },
        ...Array.from({ length: 5 }, () => ({ label: "Yes" })),
      ],
      links: [
        { title: "Open", url: "https://example.com" },
        { title: "Open", url: "/tmp/a file" },
        { title: "Open", url: "~/Desktop/a" },
      ],
    });
    expect(decisions.next).toBeUndefined();
    expect(normalizeDecisions({ needs: "other" })).toBeUndefined();
    expect(normalizeDecisions(null)).toBeUndefined();
  });

  it("infers needs and keeps next steps only on done cards", () => {
    expect(normalizeDecisions({ asks: [{ question: "  " }] })).toEqual({ needs: "nothing" });
    expect(normalizeDecisions({ needs: "you" })).toEqual({ needs: "you" });
    expect(
      normalizeDecisions({
        needs: "nothing",
        asks: [{ question: "Ignore" }],
        next: [" Try it ", "Try it", "", "Two", "Three", "Four"],
      }),
    ).toEqual({ needs: "nothing", next: ["Try it", "Two", "Three"] });
    expect(
      normalizeDecisions({
        asks: [{ question: "Deploy?", options: [{ label: "Yes" }], suggested: 0 }],
      })?.asks?.[0]?.suggested,
    ).toBe(0);
  });

  it("formats only answered asks or selected follow-ups in original order", () => {
    expect(
      decisionsMessage(
        {
          needs: "you",
          asks: [{ question: "Deploy?" }, { question: "Where?" }, { question: "Check?" }],
        },
        { answers: { 0: "Ship it", 1: " My own\n answer " }, next: [] },
      ),
    ).toBe("Deploy? → Ship it\nWhere? → My own answer");
    expect(
      decisionsMessage(
        { needs: "nothing", next: ["Add tests", "Polish UI", "Ship"] },
        { answers: {}, next: [2, 0, 2] },
      ),
    ).toBe("Also: Add tests\nAlso: Ship");
  });
});

it("retains bounded decision cards through compaction and provider envelopes", () => {
  const decisions = normalizeDecisions({
    asks: Array.from({ length: 10 }, () => ({
      question: "Pick?",
      options: Array.from({ length: 6 }, (_, index) => ({
        label: `Option ${index}`,
        does: "d".repeat(90),
      })),
      links: Array.from({ length: 3 }, () => ({
        title: "Open",
        url: `https://example.com/${"a".repeat(1800)}`,
      })),
    })),
  })!;
  for (const toolName of ["t3-code.end_turn", "mcp__t3-code__end_turn"]) {
    const output = [{ type: "text", text: JSON.stringify({ decisions }) }];
    expect(decisionsFromToolItem({ toolName, output })).toEqual(decisions);
    expect(decisionsFromToolItem({ toolName, output: compactDynamicToolOutput(output) })).toEqual(
      decisions,
    );
    expect(
      decisionsFromToolItem({ toolName, output: { isError: true, content: output } }),
    ).toBeUndefined();
    expect(decisionsFromToolItem({ toolName: "other.end_turn", output })).toBeUndefined();
  }
});
