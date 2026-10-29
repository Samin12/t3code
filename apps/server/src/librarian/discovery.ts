import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const discoverRepos = Effect.fn("ProjectLibrarian.discoverRepos")(function* (
  home: string,
  registered: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Compare real paths: a project's root is often a symlink to a repo somewhere else
  // (~/SaminOS/Projects/creatorclub -> ~/Developer/creatorclub), and offering the target
  // would let the librarian register the same repo twice.
  const real = (root: string) =>
    fs.realPath(root).pipe(Effect.orElseSucceed(() => path.resolve(root)));
  const known = new Set<string>();
  for (const root of registered) known.add(yield* real(root));
  const repos: string[] = [];
  for (const parent of ["Developer", "Projects", "SaminOS/Projects"]) {
    const directory = path.join(home, parent);
    const children = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
    for (const name of children.toSorted()) {
      const root = path.join(directory, name);
      const resolved = yield* real(root);
      if (known.has(resolved)) continue;
      const stat = yield* fs.stat(path.join(root, ".git")).pipe(Effect.option);
      if (stat._tag === "Some" && stat.value.type === "Directory") {
        known.add(resolved);
        repos.push(root);
      }
      if (repos.length >= 80) return repos;
    }
  }
  return repos;
});
