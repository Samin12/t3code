import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";

export function modelPickerUsage(limits: ServerProviderUsageLimits | undefined, now: number) {
  const notice = !limits
    ? "Usage not reported"
    : limits.unavailable
      ? (limits.unavailable.message ?? "Usage unavailable")
      : limits.windows.length === 0
        ? "Usage not reported"
        : null;
  const accountWindows =
    limits?.windows.filter((window) => !window.id.startsWith("seven_day_")) ?? [];
  const hasCursorPools = ["autoPercentUsed", "apiPercentUsed"].every((id) =>
    accountWindows.some((window) => window.id === id),
  );
  const windows = notice
    ? []
    : accountWindows
        .filter((window) => !hasCursorPools || window.id !== "totalPercentUsed")
        .map((window) => {
          const resetAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
          const awaitingRefresh = Number.isFinite(resetAt) && resetAt <= now;
          const exhausted = window.usedPercent >= 100 && !awaitingRefresh;
          return {
            id: window.id,
            kind: window.kind,
            label:
              window.windowDurationMins === 300 || window.id === "five_hour"
                ? "5-hour"
                : window.label,
            remaining: remainingPercent(window),
            exhausted,
            awaitingRefresh,
            resetAt: Number.isFinite(resetAt) ? resetAt : null,
            reset: awaitingRefresh
              ? "Reset passed · refresh usage"
              : (formatResetsIn(window, now) ?? "Reset time unavailable"),
          };
        });
  // Cursor pools are alternatives; a Claude model-only bucket cannot exhaust the account.
  const exhausted =
    windows.some((window) => window.exhausted) &&
    (!hasCursorPools || windows.every((window) => window.exhausted));
  const weeklyExhausted =
    exhausted && windows.some((window) => window.kind === "weekly" && window.exhausted);
  return {
    windows,
    notice: notice ?? (windows.length === 0 ? "Account usage not reported" : null),
    exhausted,
    weeklyExhausted,
    detail:
      windows
        .map(
          (window) =>
            `${window.label}: ${window.awaitingRefresh ? "awaiting update" : window.exhausted ? "limit reached" : `${window.remaining}% left`} · ${window.reset}`,
        )
        .join("\n") ||
      notice ||
      "Account usage not reported",
  };
}

export type ModelPickerUsageState = ReturnType<typeof modelPickerUsage>;
