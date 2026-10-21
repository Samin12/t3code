import { describe, expect, it } from "vite-plus/test";
import { heptabasePromptContext, splitHeptabaseContext } from "./promptContext";

describe("Heptabase message context", () => {
  it("keeps live board context available separately from the user's message", () => {
    const suffix = heptabasePromptContext({
      binding: {
        boardId: "93e728e4-c8a0-403d-b31d-54b6f5dd5b73",
        title: "Our board",
        linkedAt: "2026-10-06",
      },
      workspaceId: null,
      context: "card: new note",
    });
    const parsed = splitHeptabaseContext("What is on this board?" + suffix);
    expect(parsed.text).toBe("What is on this board?");
    expect(parsed.context).toContain("card: new note");
    expect(parsed.context).toContain(
      "heptabase whiteboard read 93e728e4-c8a0-403d-b31d-54b6f5dd5b73",
    );
  });
  it("does not attach context after unlink or hide ordinary user text", () => {
    expect(heptabasePromptContext({ binding: null, workspaceId: null })).toBe("");
    const text = "Explain <heptabase_session_context> tags.</heptabase_session_context>";
    expect(splitHeptabaseContext(text)).toEqual({ text, context: null });
  });
});
