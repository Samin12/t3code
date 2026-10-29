import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { decisionsFromToolItem } from "@t3tools/shared/toolOutput";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const threadId = ThreadId.make("decision-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "decision-session",
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "decisions-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "decisions-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

it.effect("registers end_turn, normalizes both provider outputs, and enforces caller access", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    expect(server.tools.some(({ tool }) => tool.name === "end_turn")).toBe(true);
    const call = (current: McpInvocationContext.McpInvocationScope) =>
      server
        .callTool({
          name: "end_turn",
          arguments: {
            asks: [
              {
                question: "Deploy?",
                options: [{ label: "Ship it", does: "I deploy" }],
                suggested: 5,
              },
            ],
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, current),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    const result = yield* call(scope);
    expect(result.isError).not.toBe(true);
    const expected = {
      needs: "you",
      asks: [{ question: "Deploy?", options: [{ label: "Ship it", does: "I deploy" }] }],
    };
    expect(decisionsFromToolItem({ toolName: "t3-code.end_turn", output: result })).toEqual(
      expected,
    );
    expect(
      decisionsFromToolItem({ toolName: "mcp__t3-code__end_turn", output: result.content }),
    ).toEqual(expected);
    for (const denied of [
      { ...scope, thread: undefined },
      { ...scope, client: { sessionId: "client", label: "Client", access: "read-only" as const } },
    ]) {
      const result = yield* call(denied);
      expect(result.isError).toBe(true);
    }
    const readonly = yield* call(scope).pipe(
      Effect.provideService(ThreadManagement.ThreadManagementService, {
        ...(yield* ThreadManagement.ThreadManagementService),
        getThreadShell: (id) =>
          Effect.succeed(
            McpToolAccessTestkit.liveThreadShell(id, {
              runtimeMode: "approval-required",
              interactionMode: "plan",
            }),
          ),
      }),
    );
    expect(readonly.isError).not.toBe(true);
  }).pipe(
    Effect.provide(
      McpHttpServer.layerDecisionsToolkit.pipe(
        Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
        Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
      ),
    ),
  ),
);
