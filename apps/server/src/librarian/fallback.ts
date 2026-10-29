import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";

class LibrarianNoProjectsError extends Schema.TaggedError<LibrarianNoProjectsError>()(
  "LibrarianNoProjectsError",
  {},
) {}

export const resolveLibrarianFallback = Effect.fn("ProjectLibrarian.resolveFallback")(function* () {
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const snapshot = yield* projects.snapshot;
  const active = snapshot.projects.filter(
    (project) => project.deletedAt === null && project.archivedAt == null,
  );
  const preferred = (yield* settings.getSettings).librarianFallbackProjectId;
  // Sidebar sorting is a client preference; the server uses pinned, then creation order.
  const first = [...active].sort(
    (a, b) => Number(b.pinnedAt != null) - Number(a.pinnedAt != null),
  )[0];
  const fallback = active.find((project) => project.id === preferred) ?? first;
  if (!fallback) return yield* new LibrarianNoProjectsError({});
  return fallback.id;
});
