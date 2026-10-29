import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// This fork's migration rides after upstream's, so upstream can claim its id. Forgetting the old row
// lets the migrator run what that id hid; the table stays and the migration re-runs as a no-op.
export const reconcileThreadCallNamesMigration = Effect.fn("reconcileThreadCallNamesMigration")(
  function* (currentId: number) {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
    `;
    if (tables.length === 0) return;
    yield* sql`
      DELETE FROM effect_sql_migrations
      WHERE name = 'ThreadCallNames' AND migration_id < ${currentId}
    `;
  },
);
