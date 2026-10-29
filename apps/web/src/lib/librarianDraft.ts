export function draftUsesLibrarian(
  enabled: boolean,
  options?: {
    librarian?: boolean;
    branch?: string | null;
    worktreePath?: string | null;
    envMode?: string;
  },
) {
  return (
    options?.librarian ??
    (enabled &&
      options?.branch == null &&
      options?.worktreePath == null &&
      options?.envMode === undefined)
  );
}
