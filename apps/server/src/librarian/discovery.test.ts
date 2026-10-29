import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { discoverRepos } from "./discovery.ts";

it.effect(
  "discovers only immediate git repos, omitting registered roots and linked worktrees, capped at 80",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const repo = path.join(home, "Developer", "app");
      const registered = path.join(home, "Projects", "known");
      const worktree = path.join(home, "Developer", "linked");
      yield* fs.makeDirectory(path.join(repo, ".git"), { recursive: true });
      yield* fs.makeDirectory(path.join(registered, ".git"), { recursive: true });
      yield* fs.makeDirectory(worktree);
      yield* fs.writeFileString(path.join(worktree, ".git"), "gitdir: /elsewhere");
      yield* fs.makeDirectory(path.join(home, "Developer", "group", "nested", ".git"), {
        recursive: true,
      });
      const other = path.join(home, "SaminOS", "Projects", "other");
      yield* fs.makeDirectory(path.join(other, ".git"), { recursive: true });
      expect(yield* discoverRepos(home, [registered])).toEqual([repo, other]);
      for (let index = 0; index < 85; index++)
        yield* fs.makeDirectory(path.join(home, "Projects", `repo-${index}`, ".git"), {
          recursive: true,
        });
      expect(yield* discoverRepos(home, [registered])).toHaveLength(80);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("omits a repo whose project is registered through a symlink", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const repo = path.join(home, "Developer", "creatorclub");
    yield* fs.makeDirectory(path.join(repo, ".git"), { recursive: true });
    yield* fs.makeDirectory(path.join(home, "SaminOS", "Projects"), { recursive: true });
    const link = path.join(home, "SaminOS", "Projects", "creatorclub");
    yield* fs.symlink(repo, link);
    expect(yield* discoverRepos(home, [link])).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
