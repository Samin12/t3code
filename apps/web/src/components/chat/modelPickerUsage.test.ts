import { describe, expect, it } from "vite-plus/test";
import { modelPickerUsage } from "./ModelPickerUsage.logic";

const now = Date.parse("2026-10-16T12:00:00Z");
const session = {
  id: "five_hour",
  kind: "session" as const,
  label: "Session",
  usedPercent: 50,
  resetsAt: "2026-10-16T14:00:00Z",
};
const weekly = {
  id: "seven_day",
  kind: "weekly" as const,
  label: "Weekly",
  usedPercent: 75,
  resetsAt: "2026-10-19T12:00:00Z",
};
const limits = (windows = [session, weekly]) => ({ checkedAt: "2026-10-16T12:00:00Z", windows });

describe("model picker account usage", () => {
  it("shows both allowances and their reset countdowns", () => {
    const usage = modelPickerUsage(limits(), now);
    expect(usage.exhausted).toBe(false);
    expect(usage.windows.map((w) => [w.label, w.remaining, w.reset])).toEqual([
      ["5-hour", 50, "resets in 2h 0m"],
      ["Weekly", 25, "resets in 3d 0h"],
    ]);
  });
  it("distinguishes session, weekly and both exhausted", () => {
    expect(modelPickerUsage(limits([{ ...session, usedPercent: 100 }, weekly]), now)).toMatchObject(
      { exhausted: true, weeklyExhausted: false },
    );
    expect(modelPickerUsage(limits([session, { ...weekly, usedPercent: 100 }]), now)).toMatchObject(
      { exhausted: true, weeklyExhausted: true },
    );
    expect(
      modelPickerUsage(
        limits([
          { ...session, usedPercent: 100 },
          { ...weekly, usedPercent: 100 },
        ]),
        now,
      ).windows.every((w) => w.exhausted),
    ).toBe(true);
  });
  it("does not mistake rounding for exhaustion", () => {
    expect(modelPickerUsage(limits([{ ...session, usedPercent: 99.9 }]), now).exhausted).toBe(
      false,
    );
  });
  it("does not invent restored quota after a reset", () => {
    const usage = modelPickerUsage(limits([{ ...session, usedPercent: 100 }]), now + 3 * 3600000);
    expect(usage.exhausted).toBe(false);
    expect(usage.windows[0]).toMatchObject({
      awaitingRefresh: true,
      reset: "Reset passed · refresh usage",
    });
  });
  it("does not fade accounts whose quotas cannot be read", () => {
    expect(modelPickerUsage(undefined, now)).toMatchObject({
      exhausted: false,
      notice: "Usage not reported",
    });
    expect(
      modelPickerUsage({ ...limits(), unavailable: { reason: "probeFailed" } }, now),
    ).toMatchObject({ exhausted: false, notice: "Usage unavailable", windows: [] });
  });
  it("keeps a model-only limit from fading the entire account", () => {
    expect(
      modelPickerUsage(
        limits([session, { ...weekly, id: "seven_day_sonnet", usedPercent: 100 }]),
        now,
      ).exhausted,
    ).toBe(false);
  });
  it("keeps Cursor usable until both alternative pools are exhausted", () => {
    const cursor = {
      checkedAt: limits().checkedAt,
      windows: [
        { ...session, id: "autoPercentUsed", usedPercent: 100 },
        { ...session, id: "apiPercentUsed", usedPercent: 20 },
        { ...session, id: "totalPercentUsed", usedPercent: 100 },
      ],
    };
    expect(modelPickerUsage(cursor, now)).toMatchObject({ exhausted: false });
    expect(modelPickerUsage(cursor, now).windows).toHaveLength(2);
    expect(
      modelPickerUsage(
        { ...cursor, windows: cursor.windows.map((w) => ({ ...w, usedPercent: 100 })) },
        now,
      ).exhausted,
    ).toBe(true);
  });
  it("retains a reached limit when no reset time was reported", () => {
    expect(
      modelPickerUsage(limits([{ ...session, usedPercent: 100, resetsAt: "invalid" }]), now)
        .windows[0],
    ).toMatchObject({ exhausted: true, resetAt: null, reset: "Reset time unavailable" });
  });
});
