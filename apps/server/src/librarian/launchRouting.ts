import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ProjectLibrarian from "./ProjectLibrarian.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import {
  ThreadLaunchError,
  type ThreadLaunchInput,
} from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";

export const routeLaunch = Effect.fn("ProjectLibrarian.routeLaunch")(function* (
  input: ThreadLaunchInput,
): Effect.fn.Return<
  {
    readonly input: ThreadLaunchInput;
    readonly filing?: ProjectLibrarian.RouteResult;
  },
  ThreadLaunchError,
  | CommandReceiptStore.CommandReceiptStoreV2
  | ThreadManagement.ThreadManagementService
  | ProjectService.ProjectService
> {
  if (
    input.librarian !== true ||
    input.initialMessage === undefined ||
    input.reuseExistingThread === true
  )
    return { input };
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  // Recover the accepted project even when history was pruned or saving it failed.
  const librarian = yield* Effect.serviceOption(ProjectLibrarian.ProjectLibrarian);
  const failure = (operation: ThreadLaunchError["operation"]) => (cause: unknown) =>
    new ThreadLaunchError({
      operation,
      commandId: input.commandId,
      projectId: input.projectId,
      cause,
    });
  const receipt = yield* receipts
    .getByCommandId(input.commandId)
    .pipe(Effect.mapError(failure("read-receipt")));
  if (Option.isSome(receipt) && receipt.value.status === "accepted" && receipt.value.threadId) {
    const shell = yield* threads
      .getThreadShell(receipt.value.threadId)
      .pipe(Effect.mapError(failure("read-receipt")));
    if (shell) {
      const project = yield* projects
        .getById(shell.projectId)
        .pipe(Effect.mapError(failure("resolve-project")));
      const previous = Option.isSome(librarian)
        ? yield* librarian.value
            .filingForThread(shell.id)
            .pipe(Effect.catchCause(() => Effect.undefined))
        : undefined;
      return {
        input: {
          ...input,
          projectId: shell.projectId,
          workspaceStrategy:
            shell.projectId === input.projectId ? input.workspaceStrategy : { type: "root" },
        },
        filing:
          previous?.projectId === shell.projectId
            ? previous
            : {
                projectId: shell.projectId,
                projectTitle: Option.isSome(project) ? project.value.title : "Project",
                reason: "Restored the original filing",
                createdProject: false,
                via: "fallback",
              },
      };
    }
  }
  if (Option.isNone(librarian)) return { input };
  let fallbackProjectId = input.projectId;
  const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  if (Option.isSome(settings)) {
    const configured = yield* settings.value.getSettings.pipe(Effect.option);
    if (Option.isSome(configured) && configured.value.librarianFallbackProjectId) {
      const fallback = yield* projects
        .getById(configured.value.librarianFallbackProjectId)
        .pipe(Effect.option);
      if (
        Option.isSome(fallback) &&
        Option.isSome(fallback.value) &&
        fallback.value.value.archivedAt == null
      )
        fallbackProjectId = fallback.value.value.id;
    }
  }
  const filing = yield* librarian.value
    .route({
      text: input.initialMessage.text,
      attachmentCount: input.initialMessage.attachments.length,
      fallbackProjectId,
    })
    .pipe(
      Effect.catchCause(() =>
        Effect.succeed({
          projectId: fallbackProjectId,
          projectTitle: "Project",
          reason: "Kept in the catch-all project",
          createdProject: false,
          via: "fallback" as const,
        }),
      ),
    );
  return {
    input: {
      ...input,
      projectId: filing.projectId,
      workspaceStrategy:
        filing.projectId === input.projectId ? input.workspaceStrategy : { type: "root" },
    },
    filing,
  };
});
