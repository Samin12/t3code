import { describe, expect, it } from "vite-plus/test";
import { createThreadTraversalKeypressGuard } from "./threadTraversalKeypressGuard";

describe("thread traversal keypresses", () => {
  it("rejects duplicate non-repeat keydowns until the arrow is released", () => {
    const guard = createThreadTraversalKeypressGuard();
    const tap = { key: "ArrowRight", repeat: false };
    expect(guard.accept(tap)).toBe(true);
    expect(guard.accept(tap)).toBe(false);
    guard.release({ key: "Shift" });
    expect(guard.accept(tap)).toBe(false);
    guard.release(tap);
    expect(guard.accept(tap)).toBe(true);
  });

  it("preserves rapid distinct taps in either direction", () => {
    const guard = createThreadTraversalKeypressGuard();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]) {
      const tap = { key, repeat: false };
      expect(guard.accept(tap)).toBe(true);
      expect(guard.accept(tap)).toBe(false);
      guard.release(tap);
    }
  });

  it("rejects native repeats and recovers when focus leaves the window", () => {
    const guard = createThreadTraversalKeypressGuard();
    expect(guard.accept({ key: "ArrowLeft", repeat: true })).toBe(false);
    expect(guard.accept({ key: "ArrowLeft", repeat: false })).toBe(true);
    guard.reset();
    expect(guard.accept({ key: "ArrowLeft", repeat: false })).toBe(true);
  });

  it("releases the physical key even if modifiers change its character", () => {
    const guard = createThreadTraversalKeypressGuard();
    const shortcut = { key: "}", code: "BracketRight", repeat: false };
    expect(guard.accept(shortcut)).toBe(true);
    guard.release({ key: "]", code: "BracketRight" });
    expect(guard.accept(shortcut)).toBe(true);
  });
});
