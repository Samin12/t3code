import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Names survive projection rebuilds and may be reused after a thread settles.
  // IF NOT EXISTS: reconcileThreadCallNamesMigration re-runs this on databases that already have it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_call_names (
      thread_id TEXT PRIMARY KEY NOT NULL,
      call_name TEXT NOT NULL
    )
  `;
});
