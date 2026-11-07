import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  type Project,
  ProviderInstanceId,
  ProviderDriverKind,
  ServerProvider,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Deferred from "effect/Deferred";
import * as TestClock from "effect/testing/TestClock";
import * as Fiber from "effect/Fiber";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Projects from "../project/ProjectService.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as Settings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectLibrarian from "./ProjectLibrarian.ts";

const decodeProvider = Schema.decodeUnknownEffect(ServerProvider);
const encodeAnswer = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const fallbackId = ProjectId.make("general");
const appId = ProjectId.make("app");
const layerFiles = ServerConfig.layerTest(process.cwd(), { prefix: "t3-librarian-test-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "librarian routes paths without a model, validates model answers, registers only offered repos, times out, and keeps 100 filings",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const home = yield* fs.makeTempDirectoryScoped();
      const repo = path.join(home, "Developer", "new-app");
      yield* fs.makeDirectory(path.join(repo, ".git"), { recursive: true });
      const projects = [
        { id: fallbackId, title: "General", workspaceRoot: home, deletedAt: null },
        {
          id: appId,
          title: "App",
          workspaceRoot: path.join(home, "app"),
          repositoryIdentity: { displayName: "acme/app" },
          deletedAt: null,
        },
        {
          id: ProjectId.make("archived"),
          title: "Old",
          workspaceRoot: path.join(home, "old"),
          archivedAt: "2026-01-01",
          deletedAt: null,
        },
      ] as unknown as Project[];
      const claude = ProviderInstanceId.make("claude_personal");
      const provider = yield* decodeProvider({
        instanceId: claude,
        driver: "claudeAgent",
        title: "Claude",
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-01-01T00:00:00Z",
        models: [],
      });
      const started = yield* Deferred.make<void>();
      let answer = '{"project":"app","newFolder":null,"why":"Fixes the app"}';
      let calls = 0;
      let hang = false;
      const registrations: string[] = [];
      const deps = Layer.mergeAll(
        Layer.mock(Projects.ProjectService)({
          snapshot: Effect.succeed({
            projects,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          }),
          bootstrap: (input) =>
            Effect.sync(() => {
              registrations.push(input.workspaceRoot);
              return {
                project: {
                  ...projects[1]!,
                  id: input.projectId,
                  title: input.title,
                  workspaceRoot: input.workspaceRoot,
                },
                created: true,
              };
            }),
        }),
        ProviderRegistryMock.layer([provider]),
        Settings.layerTest({
          providerInstances: {
            [claude]: { driver: ProviderDriverKind.make("claudeAgent"), enabled: true },
          },
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: (input) =>
            Effect.gen(function* () {
              calls++;
              expect(input.modelSelection).toEqual({
                instanceId: claude,
                model: "claude-haiku-5-5",
              });
              expect(input.prompt).not.toContain('"title":"Old"');
              if (hang) {
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }
              return { transcription: answer };
            }),
        }),
        Sqlite.layerMemory,
        NodeCrypto.layer,
      );
      yield* Effect.gen(function* () {
        const librarian = yield* ProjectLibrarian.ProjectLibrarian;
        const route = () =>
          librarian.route({
            text: "Fix the app",
            attachmentCount: 0,
            fallbackProjectId: fallbackId,
          });
        expect(
          (yield* librarian.route({
            text: `Fix ${home}/app/src/index.ts`,
            attachmentCount: 0,
            fallbackProjectId: fallbackId,
          })).via,
        ).toBe("path");
        expect(calls).toBe(0);
        expect((yield* route()).projectId).toBe(appId);
        answer = '{"project":null,"newFolder":"/invented","why":"New work"}';
        expect((yield* route()).via).toBe("fallback");
        expect(registrations).toEqual([]);
        answer = yield* encodeAnswer({
          project: null,
          newFolder: repo,
          why: "Builds the new app",
        });
        expect((yield* route()).createdProject).toBe(true);
        expect(registrations).toEqual([repo]);
        hang = true;
        const fiber = yield* route().pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("16 seconds");
        expect((yield* Fiber.join(fiber)).projectId).toBe(fallbackId);
        for (let index = 0; index < 102; index++)
          yield* librarian.record(ThreadId.make(`thread-${index}`), {
            projectId: appId,
            projectTitle: "App",
            reason: "Fixes the app",
            createdProject: false,
            via: "model",
          });
        const history = yield* fs
          .readFileString(path.join(config.stateDir, "librarian.json"))
          .pipe(
            Effect.flatMap(
              Schema.decodeEffect(
                Schema.fromJsonString(
                  Schema.Array(Schema.Struct({ threadId: Schema.String, why: Schema.String })),
                ),
              ),
            ),
          );
        expect(history).toHaveLength(100);
        expect(history[0]?.threadId).toBe("thread-2");
        expect((yield* librarian.filingForThread(ThreadId.make("thread-101")))?.reason).toBe(
          "Fixes the app",
        );
      }).pipe(
        Effect.provide(ProjectLibrarian.layer.pipe(Layer.provide(deps))),
        Effect.provideService(HostProcess.HomeDirectory, home),
      );
    }).pipe(Effect.scoped, Effect.provide(layerFiles)),
);
