import { describe, expect, it } from "vite-plus/test";
import { guestKey, pointerToGuest } from "./terminalMac.logic";
const modifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("virtual Mac input", () => {
  it("uses guest points through Retina pixels and both letterbox directions", () => {
    const display = { width: 2000, height: 1000, pointWidth: 1000, pointHeight: 500 };
    const rect = { left: 10, top: 20, width: 500, height: 500 };
    expect(pointerToGuest(260, 270, rect, display)).toEqual({ x: 500, y: 250 });
    expect(pointerToGuest(260, 30, rect, display)).toBeNull();
    expect(pointerToGuest(260, 30, rect, display, true)).toEqual({ x: 500, y: 0 });
    expect(pointerToGuest(900, 900, rect, display, true)).toEqual({ x: 999, y: 499 });
    expect(pointerToGuest(10, 145, rect, display)).toEqual({ x: 0, y: 0 });
    const wide = { left: 0, top: 0, width: 1000, height: 250 };
    expect(pointerToGuest(500, 125, wide, display)).toEqual({ x: 500, y: 250 });
    expect(pointerToGuest(100, 125, wide, display)).toBeNull();
    expect(pointerToGuest(0, 0, { ...rect, width: 0 }, display)).toBeNull();
  });
  it("types unmodified Unicode and sends supported guest key chords", () => {
    expect(guestKey({ ...modifiers, key: "A", shiftKey: true })).toEqual({
      action: "type",
      text: "A",
    });
    expect(guestKey({ ...modifiers, key: "😀" })).toEqual({ action: "type", text: "😀" });
    expect(guestKey({ ...modifiers, key: " ", metaKey: true })).toEqual({
      action: "key",
      key: "cmd+space",
    });
    expect(
      guestKey({ ...modifiers, key: "$", code: "Digit4", metaKey: true, shiftKey: true }),
    ).toEqual({ action: "key", key: "cmd+shift+4" });
    expect(guestKey({ ...modifiers, key: "ArrowLeft", ctrlKey: true, altKey: true })).toEqual({
      action: "key",
      key: "ctrl+option+left",
    });
    for (const [key, mapped] of [
      ["Enter", "return"],
      ["Backspace", "backspace"],
      ["Delete", "delete"],
      ["Escape", "escape"],
      ["PageDown", "pagedown"],
      ["F12", "f12"],
    ])
      expect(guestKey({ ...modifiers, key: key! })).toEqual({ action: "key", key: mapped });
    expect(guestKey({ ...modifiers, key: "Meta" })).toBeNull();
    expect(guestKey({ ...modifiers, key: "F13" })).toBeNull();
    expect(guestKey({ ...modifiers, key: "Dead" })).toBeNull();
  });
});
