import * as NodeOS from "node:os";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Path from "effect/Path";
import {
  CommandId,
  ProjectId,
  ThreadId,
  type OrchestrationV2LibrarianFiling,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { discoverRepos } from "./discovery.ts";
import {
  buildPrompt,
  librarianModel,
  parseAnswer,
  pathProject,
  type Candidate,
} from "./routing.ts";

export interface RouteInput {
  readonly text: string;
  readonly attachmentCount: number;
  readonly fallbackProjectId: ProjectId;
}
export interface RouteResult extends OrchestrationV2LibrarianFiling {
  readonly via: "model" | "path" | "fallback";
}
const HistoryEntry = Schema.Struct({
  at: Schema.String,
  threadId: ThreadId,
  projectId: ProjectId,
  projectTitle: Schema.String,
  why: Schema.String,
  createdProject: Schema.Boolean,
  via: Schema.Literals(["model", "path", "fallback"]),
});
const History = Schema.fromJsonString(Schema.Array(HistoryEntry));
const encodeHistory = Schema.encodeEffect(History);

export class ProjectLibrarian extends Context.Service<
  ProjectLibrarian,
  {
    readonly route: (input: RouteInput) => Effect.Effect<RouteResult>;
    readonly filingForThread: (threadId: ThreadId) => Effect.Effect<RouteResult | undefined>;
    readonly record: (threadId: ThreadId, filing: RouteResult) => Effect.Effect<void>;
  }
>()("t3/librarian/ProjectLibrarian") {}

const make = Effect.gen(function* () {
  const home = yield* HostProcess.HomeDirectory;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const historyPath = path.join(config.stateDir, "librarian.json");
  const lock = yield* Semaphore.make(1);
  const scan = yield* Effect.cachedWithTTL(
    Effect.gen(function* () {
      const snapshot = yield* projects.snapshot;
      return yield* discoverRepos(
        home,
        snapshot.projects.map((project) => project.workspaceRoot),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    }),
    "3 minutes",
  );

  const route = Effect.fn("ProjectLibrarian.route")(function* (input: RouteInput) {
    const fallback: RouteResult = {
      projectId: input.fallbackProjectId,
      projectTitle: "Project",
      reason: "Kept in the catch-all project",
      createdProject: false,
      via: "fallback",
    };
    return yield* Effect.gen(function* () {
      const snapshot = yield* projects.snapshot;
      const fallbackTitle = snapshot.projects.find(
        (project) => project.id === input.fallbackProjectId,
      )?.title;
      const defaultResult = { ...fallback, projectTitle: fallbackTitle ?? fallback.projectTitle };
      return yield* Effect.gen(function* () {
        const recent = yield* sql<{ readonly project_id: string; readonly title: string }>`
          SELECT project_id, title FROM (
            SELECT project_id, title, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY updated_at DESC) AS position
            FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL
          ) WHERE position <= 6
        `;
        const candidates: Candidate[] = snapshot.projects
          .filter((project) => project.deletedAt === null && project.archivedAt == null)
          .map((project) => ({
            id: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
            repository: project.repositoryIdentity?.displayName ?? null,
            recentThreads: recent
              .filter((thread) => thread.project_id === project.id)
              .map((thread) => thread.title),
          }));
        const direct = pathProject(input.text, candidates, home);
        if (direct)
          return {
            projectId: direct.id,
            projectTitle: direct.title,
            reason: "Message names a path in this project",
            createdProject: false,
            via: "path" as const,
          };
        const known = new Set(snapshot.projects.map((project) => project.workspaceRoot));
        const repos = (yield* scan).filter((root) => !known.has(root));
        const modelSelection = librarianModel(
          yield* settings.getSettings,
          yield* providers.getProviders,
        );
        if (!modelSelection) return defaultResult;
        const generated = yield* generation.generateTranscriptionPostProcessing({
          // A neutral folder, as thread titles use: a project root would load its CLAUDE.md
          // and the rest of its agent context into every filing.
          cwd: NodeOS.tmpdir(),
          prompt: buildPrompt({ ...input, candidates, repos }),
          modelSelection,
        });
        const answer = parseAnswer(generated.transcription, candidates, repos);
        if (!answer) return defaultResult;
        if (answer.project) {
          const project = candidates.find((candidate) => candidate.id === answer.project)!;
          return {
            projectId: project.id,
            projectTitle: project.title,
            reason: answer.why,
            createdProject: false,
            via: "model" as const,
          };
        }
        if (answer.newFolder) {
          const id = yield* randomUuidV4;
          const created = yield* projects.bootstrap({
            commandId: CommandId.make(`librarian:${id}`),
            projectId: ProjectId.make(id),
            title: path.basename(answer.newFolder),
            workspaceRoot: answer.newFolder,
          });
          return {
            projectId: created.project.id,
            projectTitle: created.project.title,
            reason: answer.why,
            createdProject: created.created,
            via: "model" as const,
          };
        }
        return { ...defaultResult, reason: answer.why };
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.catchCause(() => Effect.succeed(defaultResult)),
      );
    }).pipe(Effect.catchCause(() => Effect.succeed(fallback)));
  });

  const readHistory = fs.readFileString(historyPath).pipe(
    Effect.flatMap(Schema.decodeEffect(History)),
    Effect.orElseSucceed(() => []),
  );
  const filingForThread = Effect.fn("ProjectLibrarian.filingForThread")(function* (
    threadId: ThreadId,
  ) {
    const entry = (yield* readHistory).find((filing) => filing.threadId === threadId);
    return entry
      ? {
          projectId: entry.projectId,
          projectTitle: entry.projectTitle,
          reason: entry.why,
          createdProject: entry.createdProject,
          via: entry.via,
        }
      : undefined;
  });

  const record = Effect.fn("ProjectLibrarian.record")(function* (
    threadId: ThreadId,
    filing: RouteResult,
  ) {
    yield* Effect.logInfo("Librarian filed thread").pipe(
      Effect.annotateLogs({
        threadId,
        projectId: filing.projectId,
        projectTitle: filing.projectTitle,
        why: filing.reason,
        via: filing.via,
      }),
    );
    yield* lock
      .withPermit(
        Effect.gen(function* () {
          const history = (yield* readHistory).filter((item) => item.threadId !== threadId);
          const { reason, ...destination } = filing;
          const entry = {
            ...destination,
            why: reason,
            threadId,
            at: DateTime.formatIso(yield* DateTime.now),
          };
          yield* fs.makeDirectory(config.stateDir, { recursive: true });
          const encoded = yield* encodeHistory([...history, entry].slice(-100));
          yield* fs.writeFileString(`${historyPath}.tmp`, encoded);
          yield* fs.rename(`${historyPath}.tmp`, historyPath);
        }),
      )
      .pipe(Effect.catchCause(() => Effect.logWarning("Could not save librarian history")));
  });
  return ProjectLibrarian.of({ route, record, filingForThread });
});
export const layer = Layer.effect(ProjectLibrarian, make);
