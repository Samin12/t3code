import { describe, expect, it } from "vite-plus/test";
import { pickThreadCallName, THREAD_CALL_NAMES } from "./threadCallNames.ts";

describe("thread call names", () => {
  it("picks deterministically and probes past occupied names regardless of case", () => {
    const first = pickThreadCallName("thread-a", []);
    expect(pickThreadCallName("thread-a", [])).toBe(first);
    const next = pickThreadCallName("thread-a", [first.toUpperCase()]);
    expect(next).not.toBe(first);
    expect(pickThreadCallName("thread-a", [first])).toBe(next);
    const occupied = new Set<string>();
    for (let index = 0; index < THREAD_CALL_NAMES.length; index++) {
      const name = pickThreadCallName(`thread-${index}`, occupied);
      expect(occupied.has(name)).toBe(false);
      occupied.add(name);
    }
    expect(occupied.size).toBe(THREAD_CALL_NAMES.length);
  });

  it("numbers overflow names and probes occupied numbered names", () => {
    const base = pickThreadCallName("overflow", []);
    expect(pickThreadCallName("overflow", THREAD_CALL_NAMES)).toBe(`${base} 2`);
    const twice = THREAD_CALL_NAMES.flatMap((name) => [name, `${name} 2`]);
    expect(pickThreadCallName("overflow", twice)).toBe(`${base} 3`);
  });
});
