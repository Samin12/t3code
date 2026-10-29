import { expect, it } from "@effect/vitest";
import { EventId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import { pickThreadCallName } from "@t3tools/shared/threadCallNames";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { idleThreadProjection, liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layer = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const create = Effect.fn("test.createNamedThread")(function* (
  threadId: ThreadId,
  overrides: Partial<OrchestrationV2AppThread> = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const thread = { ...idleThreadProjection(liveThreadShell(threadId)).thread, ...overrides };
  yield* store.apply({
    id: EventId.make(`create:${threadId}`),
    threadId,
    type: "thread.created",
    occurredAt: thread.createdAt,
    payload: thread,
  });
});

it.effect(
  "assigns distinct names at creation, reuses settled names, and preserves names on replay",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const firstId = ThreadId.make("first");
      const base = pickThreadCallName(firstId, []);
      const colliding = Array.from({ length: 5000 }, (_, index) =>
        ThreadId.make(`collision:${index}`),
      )
        .filter((id) => pickThreadCallName(id, []) === base)
        .slice(0, 3);
      expect(colliding).toHaveLength(3);
      const [secondId, thirdId, archivedReplacementId] = colliding as [
        ThreadId,
        ThreadId,
        ThreadId,
      ];
      yield* create(firstId);
      yield* create(secondId);
      const first = yield* store.getThread(firstId);
      const second = yield* store.getThread(secondId);
      expect(first.callName).toBe(base);
      expect(second.callName).not.toBe(base);
      yield* create(firstId, { settledOverride: "settled", settledAt: first.updatedAt });
      yield* create(thirdId);
      expect((yield* store.getThread(thirdId)).callName).toBe(base);
      yield* create(thirdId, { archivedAt: first.updatedAt });
      yield* create(archivedReplacementId);
      expect((yield* store.getThread(archivedReplacementId)).callName).toBe(base);
      yield* sql`DELETE FROM orchestration_v2_projection_threads WHERE thread_id = ${secondId}`;
      yield* create(secondId, { title: "Replayed" });
      expect((yield* store.getThread(secondId)).callName).toBe(second.callName);
      expect((yield* store.getThreadShell(secondId))?.callName).toBe(second.callName);
    }).pipe(Effect.provide(layer)),
);

it.effect("lazily persists names for legacy threads", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const id = ThreadId.make("legacy");
    yield* create(id);
    yield* sql`DELETE FROM thread_call_names`;
    yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_remove(payload_json, '$.callName')`;
    const thread = yield* store.getThread(id);
    expect(thread.callName).toBe(pickThreadCallName(id, []));
    const stored = yield* sql<{
      readonly call_name: string;
    }>`SELECT call_name FROM thread_call_names WHERE thread_id = ${id}`;
    expect(stored[0]?.call_name).toBe(thread.callName);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps a legacy thread readable if name storage is unavailable", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const id = ThreadId.make("missing-name-table");
    yield* create(id);
    yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_remove(payload_json, '$.callName')`;
    yield* sql`DROP TABLE thread_call_names`;
    expect((yield* store.getThread(id)).id).toBe(id);
  }).pipe(Effect.provide(layer)),
);

it.effect("lets top-level threads reuse names held only by open subagent threads", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const parentId = ThreadId.make("parent");
    const childId = ThreadId.make("child");
    const base = pickThreadCallName(childId, []);
    const topLevelId = Array.from({ length: 5000 }, (_, index) =>
      ThreadId.make(`top:${index}`),
    ).find((id) => pickThreadCallName(id, []) === base)!;
    const template = idleThreadProjection(liveThreadShell(childId)).thread;
    yield* create(childId, {
      lineage: { ...template.lineage, parentThreadId: parentId, relationshipToParent: "subagent" },
    });
    expect((yield* store.getThread(childId)).callName).toBe(base);
    yield* create(topLevelId);
    expect((yield* store.getThread(topLevelId)).callName).toBe(base);
  }).pipe(Effect.provide(layer)),
);
