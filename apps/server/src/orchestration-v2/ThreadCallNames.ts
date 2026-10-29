import { ThreadId } from "@t3tools/contracts";
import { pickThreadCallName } from "@t3tools/shared/threadCallNames";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

// Only open top-level threads hold a name; subagent threads may share one.
export const makeThreadCallNames = (sql: SqlClient.SqlClient) => {
  const assign = Effect.fn("ThreadCallNames.assign")(function* (threadId: ThreadId) {
    const existing = yield* sql<{ readonly call_name: string }>`
      SELECT call_name FROM thread_call_names WHERE thread_id = ${threadId}
    `;
    if (existing[0] !== undefined) return existing[0].call_name;
    const active = yield* sql<{ readonly call_name: string }>`
      SELECT names.call_name FROM thread_call_names names
      JOIN orchestration_v2_projection_threads threads ON threads.thread_id = names.thread_id
      WHERE threads.archived_at IS NULL AND threads.deleted_at IS NULL
        AND CASE WHEN json_valid(threads.payload_json)
          THEN json_extract(threads.payload_json, '$.settledOverride') IS NOT 'settled'
            AND json_extract(threads.payload_json, '$.lineage.parentThreadId') IS NULL
          ELSE 0 END
    `;
    const callName = pickThreadCallName(
      threadId,
      active.map((row) => row.call_name),
    );
    yield* sql`INSERT INTO thread_call_names (thread_id, call_name) VALUES (${threadId}, ${callName})`;
    return callName;
  }, sql.withTransaction);

  const backfill = Effect.fn("ThreadCallNames.backfill")(function* () {
    const missing = yield* sql<{
      readonly thread_id: string;
      readonly call_name: string | null;
      readonly active: number;
    }>`
      SELECT threads.thread_id, names.call_name,
        (threads.archived_at IS NULL AND threads.deleted_at IS NULL
          AND json_extract(threads.payload_json, '$.settledOverride') IS NOT 'settled'
          AND json_extract(threads.payload_json, '$.lineage.parentThreadId') IS NULL) AS active
      FROM orchestration_v2_projection_threads threads
      LEFT JOIN thread_call_names names ON names.thread_id = threads.thread_id
      WHERE json_valid(threads.payload_json) AND json_extract(threads.payload_json, '$.callName') IS NULL
      ORDER BY threads.created_at, threads.thread_id
    `;
    if (missing.length === 0) return;
    const occupied = yield* sql<{ readonly call_name: string }>`
      SELECT names.call_name FROM thread_call_names names
      JOIN orchestration_v2_projection_threads threads ON threads.thread_id = names.thread_id
      WHERE threads.archived_at IS NULL AND threads.deleted_at IS NULL
        AND CASE WHEN json_valid(threads.payload_json)
          THEN json_extract(threads.payload_json, '$.settledOverride') IS NOT 'settled'
            AND json_extract(threads.payload_json, '$.lineage.parentThreadId') IS NULL
          ELSE 0 END
    `;
    const used = new Set(occupied.map((row) => row.call_name));
    for (const row of missing) {
      const callName = row.call_name ?? pickThreadCallName(row.thread_id, used);
      if (row.call_name === null) {
        yield* sql`INSERT INTO thread_call_names (thread_id, call_name) VALUES (${row.thread_id}, ${callName})`;
      }
      if (row.active) used.add(callName);
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.callName', ${callName})
        WHERE thread_id = ${row.thread_id}
      `;
    }
  }, sql.withTransaction);
  return { assign, backfill };
};
