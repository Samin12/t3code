import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { threadNotFound } from "./threadAccess.ts";
import type * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export const resolveThreadReference = Effect.fn("mcp.resolveThreadReference")(function* (
  threads: Pick<
    ThreadManagement.ThreadManagementServiceShape,
    "getThreadShell" | "getShellSnapshot"
  >,
  reference: ThreadId,
) {
  const existing = yield* threads.getThreadShell(reference).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Unable to load threads.",
        }),
    ),
  );
  if (existing !== null && existing.deletedAt === null) return reference;
  const snapshot = yield* threads.getShellSnapshot({ location: "active" }).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Unable to load thread call names.",
        }),
    ),
  );
  const active = snapshot.threads.filter(
    (thread) => thread.archivedAt === null && thread.deletedAt === null,
  );
  const matches = active.filter(
    (thread) => thread.callName?.toLowerCase() === reference.trim().toLowerCase(),
  );
  matches.sort(
    (left, right) =>
      Number(left.lineage.parentThreadId !== null) -
        Number(right.lineage.parentThreadId !== null) ||
      Number(left.settledOverride === "settled") - Number(right.settledOverride === "settled") ||
      DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
  if (matches[0] !== undefined) return matches[0].id;
  const suggestions = [
    ...new Set(
      active
        .filter(
          (thread) =>
            thread.settledOverride !== "settled" && thread.lineage.parentThreadId === null,
        )
        .map((thread) => thread.callName)
        .filter((name) => name !== undefined),
    ),
  ].slice(0, 8);
  return yield* threadNotFound(
    threads,
    reference,
    `Unknown thread id or call name "${reference}".${suggestions.length === 0 ? " No active call names are available." : ` Active call names: ${suggestions.join(", ")}.`}`,
  );
});
