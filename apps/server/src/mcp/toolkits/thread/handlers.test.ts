import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { ThreadToolkit } from "./tools.ts";

it.effect("resolves call names before dispatch and ranks exact names ahead of title matches", () =>
  Effect.gen(function* () {
    const mike = { ...liveThreadShell(ThreadId.make("named-thread")), callName: "Mike" };
    const titleMatch = {
      ...liveThreadShell(ThreadId.make("title-match")),
      title: "Mike tests",
      callName: "Sky",
    };
    const commands: OrchestrationV2ServerCommand[] = [];
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        requestNamespace: "test",
        thread: undefined,
        client: { sessionId: "test", label: "Voice", access: "full-access" },
        issuedAt: 0,
        capabilities: new Set(["orchestration"] as const),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed([mike, titleMatch].find((thread) => thread.id === id) ?? null),
        getShellSnapshot: () =>
          Effect.succeed({
            schemaVersion: 2,
            snapshotSequence: 0,
            threads: [titleMatch, mike],
            archivedThreads: [],
          }),
        getProjectThreadRecords: () => Effect.succeed(idleThreadProjection(mike)),
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 1, storedEvents: [] };
          }),
      }),
      Layer.mock(ThreadSearch.ThreadSearch)({
        searchThreads: () =>
          Effect.succeed({
            matches: [
              {
                threadId: titleMatch.id,
                projectId: titleMatch.projectId,
                title: titleMatch.title,
                source: "title",
              },
            ],
          }),
      }),
    );
    const toolkit = yield* ThreadToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(dependencies)),
      ),
    );
    yield* toolkit
      .handle("t3_thread_organize", { threadId: ThreadId.make("mIkE"), action: "pin" })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(commands).toMatchObject([{ type: "thread.pin", threadId: mike.id }]);
    const result = yield* toolkit
      .handle("t3_thread_search", { query: "MIKE", limit: 1 })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(result.at(-1)?.result).toMatchObject({
      matches: [{ threadId: mike.id, callName: "Mike", title: mike.title }],
    });
    const all = yield* toolkit
      .handle("t3_thread_search", { query: "mike" })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(all.at(-1)?.result).toMatchObject({
      matches: [{ callName: "Mike" }, { callName: "Sky" }],
    });
  }),
);
