import { expect, it } from "vite-plus/test";
import { draftUsesLibrarian } from "./librarianDraft";

it("uses the preference for generic drafts and preserves explicit project/workspace choices", () => {
  expect(draftUsesLibrarian(true)).toBe(true);
  expect(draftUsesLibrarian(false)).toBe(false);
  expect(draftUsesLibrarian(true, { librarian: false })).toBe(false);
  expect(draftUsesLibrarian(false, { librarian: true })).toBe(true);
  expect(draftUsesLibrarian(true, { worktreePath: "/worktree" })).toBe(false);
  expect(draftUsesLibrarian(true, { branch: "feature" })).toBe(false);
});
