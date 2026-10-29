import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import ThreadCallNames from "./Migrations/081_ThreadCallNames.ts";

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

describe("ThreadCallNames id move", () => {
  it.effect("upgrades a database that recorded the migration at an older id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 79 });
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({ "80_ThreadCallNames": ThreadCallNames }),
      });
      yield* sql`INSERT INTO thread_call_names (thread_id, call_name) VALUES ('thread-1', 'Mike')`;

      assert.deepStrictEqual(yield* runMigrations(), [
        [80, "ScheduledTaskThreadMode"],
        [81, "ThreadCallNames"],
      ]);

      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* sql`SELECT thread_id, call_name FROM thread_call_names`, [
        { thread_id: "thread-1", call_name: "Mike" },
      ]);
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_tasks)`;
      assert.ok(columns.some((column) => column.name === "thread_mode"));
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves history alone when a newer build moved the migration later", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 80 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (81, 'FutureMainMigration'), (82, 'ThreadCallNames')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "81_ThreadCallNames (recorded: FutureMainMigration)");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
