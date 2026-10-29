import { expect, it } from "@effect/vitest";
import { ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import { resolveThreadReference } from "./threadCallNameResolution.ts";

const named = (id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) => ({
  ...liveThreadShell(ThreadId.make(id)),
  callName: "Mike",
  ...overrides,
});
const resolve = (reference: string, shells: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  resolveThreadReference(
    {
      getThreadShell: (id) => Effect.succeed(shells.find((thread) => thread.id === id) ?? null),
      getShellSnapshot: () =>
        Effect.succeed({
          schemaVersion: 2,
          snapshotSequence: 0,
          threads: shells,
          archivedThreads: [],
        }),
    },
    ThreadId.make(reference),
  );

it.effect("prefers an existing id, then active call names, then the newest matching thread", () =>
  Effect.gen(function* () {
    const newer = DateTime.makeUnsafe("2026-03-02T00:00:00Z");
    const older = DateTime.makeUnsafe("2026-03-01T00:00:00Z");
    const settled = named("settled", {
      settledOverride: "settled",
      settledAt: newer,
      updatedAt: newer,
    });
    const active = named("active", { updatedAt: older });
    const newest = named("newest", { updatedAt: newer });
    const hidden = named("archived", { archivedAt: newer });
    const deleted = named("deleted", { deletedAt: newer });
    expect(yield* resolve("mIkE", [settled, hidden, deleted, active, newest])).toBe(newest.id);
    expect(yield* resolve("Mike", [settled, active])).toBe(active.id);
    expect(yield* resolve("Mike", [settled, hidden, deleted])).toBe(settled.id);
    const exact = named("Mike", { callName: "Sky", archivedAt: newer });
    expect(yield* resolve("Mike", [active, exact])).toBe(exact.id);
    const sideChat = named("side-chat", { lineage: { ...active.lineage, sideChat: true } });
    expect(yield* resolve("Mike", [sideChat])).toBe(sideChat.id);
    const error = yield* resolve("Unknown", [active, hidden, deleted]).pipe(Effect.flip);
    expect(error.code).toBe("thread_not_found");
    expect(error.message).toContain("Active call names: Mike");
    expect(error.message).toContain("Unknown");
  }),
);
