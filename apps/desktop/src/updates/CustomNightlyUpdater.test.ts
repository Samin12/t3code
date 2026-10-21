import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { type CustomNightlyRuntime, makeCustomNightlyUpdater } from "./CustomNightlyUpdater.ts";

const CURRENT = "0.1.4-nightly.20261027.3770";
const LATEST = "0.1.4-nightly.20261028.3801";
const NOW_ISO = "2026-10-28T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);

function status(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    current: CURRENT,
    latest: LATEST,
    updateAvailable: true,
    releaseNotes: [{ version: LATEST, note: "* fix(web): a fix" }],
    build: null,
    staged: null,
    ...overrides,
  });
}

function build(state: string, percent: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: LATEST,
    state,
    phase: "Building the app",
    percent,
    message: null,
    log: "/tmp/build.log",
    updatedAt: NOW_ISO,
    ...extra,
  });
}

const setup = Effect.fn("CustomNightlyUpdaterTest.setup")(function* (options: {
  readonly helper?: (args: ReadonlyArray<string>) => Promise<string>;
  readonly builds?: ReadonlyArray<string>;
  readonly now?: number;
}) {
  const helperCalls: Array<ReadonlyArray<string>> = [];
  const events: Array<[string, unknown]> = [];
  const builds = [...(options.builds ?? [])];
  let quits = 0;
  const runtime: CustomNightlyRuntime = {
    appVersion: CURRENT,
    runHelper: (args) => {
      helperCalls.push(args);
      return options.helper ? options.helper(args) : Promise.resolve(status());
    },
    readBuildStatus: () => Promise.resolve(builds.length > 1 ? builds.shift()! : builds[0]!),
    quitApp: () => {
      quits += 1;
    },
    sleep: () => Promise.resolve(),
    now: () => options.now ?? NOW,
    pid: 42,
  };
  const updater = makeCustomNightlyUpdater(runtime);
  yield* Effect.forEach(
    ["update-available", "update-not-available", "download-progress", "update-downloaded"],
    (name) => updater.on(name, (payload: unknown) => events.push([name, payload])),
  );
  return { updater, helperCalls, events, quits: () => quits };
});

describe("CustomNightlyUpdater", () => {
  it.effect("offers the newest nightly with its release notes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, helperCalls, events } = yield* setup({});
        yield* updater.checkForUpdates;
        expect(helperCalls).toEqual([["status", "--json", "--current", CURRENT]]);
        expect(events).toEqual([
          [
            "update-available",
            { version: LATEST, releaseNotes: [{ version: LATEST, note: "* fix(web): a fix" }] },
          ],
        ]);
      }),
    ),
  );

  it.effect("reports up to date when no newer nightly exists", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, events } = yield* setup({
          helper: () => Promise.resolve(status({ latest: CURRENT, updateAvailable: false })),
        });
        yield* updater.checkForUpdates;
        expect(events).toEqual([["update-not-available", { version: CURRENT }]]);
      }),
    ),
  );

  it.effect("shows the helper's reason when a check fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater } = yield* setup({
          helper: () => Promise.reject(new Error("GitHub could not be reached")),
        });
        const error = yield* Effect.flip(updater.checkForUpdates);
        expect(error._tag).toBe("ElectronUpdaterCheckForUpdatesError");
        expect(error.message).toBe(
          "Could not check for a new nightly: GitHub could not be reached",
        );
      }),
    ),
  );

  it.effect("builds the offered nightly and reports progress until it is staged", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, helperCalls, events } = yield* setup({
          builds: [build("queued", 0), build("running", 40), build("ready", 100)],
        });
        yield* updater.checkForUpdates;
        yield* updater.downloadUpdate;
        expect(helperCalls.at(-1)).toEqual(["request-build", LATEST]);
        expect(events.slice(1)).toEqual([
          ["download-progress", { percent: 0 }],
          ["download-progress", { percent: 40 }],
          ["download-progress", { percent: 100 }],
          ["update-downloaded", { version: LATEST }],
        ]);
      }),
    ),
  );

  it.effect("fails the download with the build's own message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, events } = yield* setup({
          builds: [build("failed", 20, { message: "Merging your changes needs attention." })],
        });
        yield* updater.checkForUpdates;
        const error = yield* Effect.flip(updater.downloadUpdate);
        expect(error._tag).toBe("ElectronUpdaterDownloadUpdateError");
        expect(error.message).toBe("Merging your changes needs attention.");
        expect(events.some(([name]) => name === "update-downloaded")).toBe(false);
      }),
    ),
  );

  it.effect("gives up when the build agent stops updating its status", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater } = yield* setup({
          builds: [build("running", 60)],
          now: NOW + 4 * 60_000,
        });
        yield* updater.checkForUpdates;
        const error = yield* Effect.flip(updater.downloadUpdate);
        expect(error.message).toContain('stopped responding during "Building the app"');
      }),
    ),
  );

  it.effect("hands the built version to the installer before quitting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, helperCalls, quits } = yield* setup({ builds: [build("ready", 100)] });
        yield* updater.checkForUpdates;
        yield* updater.downloadUpdate;
        yield* updater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
        expect(helperCalls.at(-1)).toEqual(["request-install", LATEST, "--pid", "42"]);
        expect(quits()).toBe(1);
      }),
    ),
  );

  it.effect("stays open when the installer cannot take the request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { updater, quits } = yield* setup({
          builds: [build("ready", 100)],
          helper: (args) =>
            args[0] === "request-install"
              ? Promise.reject(new Error("The update agent did not respond."))
              : Promise.resolve(status()),
        });
        yield* updater.checkForUpdates;
        yield* updater.downloadUpdate;
        const error = yield* Effect.flip(
          updater.quitAndInstall({ isSilent: true, isForceRunAfter: true }),
        );
        expect(error._tag).toBe("ElectronUpdaterQuitAndInstallError");
        expect(error.message).toBe(
          "Could not start the install: The update agent did not respond.",
        );
        expect(quits()).toBe(0);
      }),
    ),
  );
});
