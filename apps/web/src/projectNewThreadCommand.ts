import { PROJECT_NEW_THREAD_COMMAND_PATTERN } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isProjectNewThreadCommand = Schema.is(PROJECT_NEW_THREAD_COMMAND_PATTERN);

/** The slug a project title answers to in `project.<slug>.newThread` ("SaminOS" is "saminos"). */
export function projectCommandSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function projectSlugFromNewThreadCommand(command: string): string | null {
  if (!isProjectNewThreadCommand(command)) return null;
  const [prefix, , suffix] = PROJECT_NEW_THREAD_COMMAND_PATTERN.parts;
  return command.slice(prefix.literal.length, -suffix.literal.length);
}

/** The first unarchived project whose title matches the slug. */
export function findProjectForSlug<T extends { title: string; archivedAt?: unknown }>(
  projects: ReadonlyArray<T>,
  slug: string,
): T | null {
  return (
    projects.find(
      (project) => project.archivedAt == null && projectCommandSlug(project.title) === slug,
    ) ?? null
  );
}
