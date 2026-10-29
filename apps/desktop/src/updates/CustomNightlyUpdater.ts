// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Desktop-only boundary to an external build agent: runs its helper and polls the status file it writes.
// Samin's custom build updates through ~/.t3/custom-build/update-nightly.py, which carries the
// custom patch onto each new upstream nightly, builds it and installs it after the app quits.
// Presenting it as ElectronUpdater keeps DesktopUpdates and the update pill unchanged, and
// main.ts never loads the stock feed, so an upstream build cannot replace this one.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ElectronUpdater from "../electron/ElectronUpdater.ts";

const POLL_INTERVAL_MS = 1_000;
// The build agent rewrites its status every few seconds while it works.
const STALLED_AFTER_MS = 3 * 60_000;
const HELPER_TIMEOUT_MS = 2 * 60_000;

const ReleaseNote = Schema.Struct({ version: Schema.String, note: Schema.String });

const HelperStatus = Schema.Struct({
  current: Schema.String,
  latest: Schema.String,
  updateAvailable: Schema.Boolean,
  releaseNotes: Schema.Array(ReleaseNote),
});

const BuildStatus = Schema.Struct({
  version: Schema.String,
  state: Schema.Literals(["queued", "running", "ready", "failed"]),
  phase: Schema.NullOr(Schema.String),
  percent: Schema.Number,
  message: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

const decodeHelperStatus = Schema.decodeUnknownSync(Schema.fromJsonString(HelperStatus));
const decodeBuildStatus = Schema.decodeUnknownSync(Schema.fromJsonString(BuildStatus));

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// Same tags as the stock errors, but the update pill shows the helper's reason instead of a
// generic "Electron updater failed" line.
class CustomNightlyCheckError extends ElectronUpdater.ElectronUpdaterCheckForUpdatesError {
  override get message(): string {
    return `Could not check for a new nightly: ${describeCause(this.cause)}`;
  }
}

class CustomNightlyBuildError extends ElectronUpdater.ElectronUpdaterDownloadUpdateError {
  override get message(): string {
    return describeCause(this.cause);
  }
}

class CustomNightlyInstallError extends ElectronUpdater.ElectronUpdaterQuitAndInstallError {
  override get message(): string {
    return `Could not start the install: ${describeCause(this.cause)}`;
  }
}

export interface CustomNightlyRuntime {
  /** The running app's version; the helper offers anything newer. */
  readonly appVersion: string;
  /** Runs the helper and resolves with its stdout; rejects with its error output. */
  readonly runHelper: (args: ReadonlyArray<string>) => Promise<string>;
  /** The helper's build status file, or null before the first build. */
  readonly readBuildStatus: () => Promise<string | null>;
  readonly quitApp: () => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly pid: number;
}

export function makeCustomNightlyUpdater(runtime: CustomNightlyRuntime) {
  const events = new NodeEvents.EventEmitter();
  let channel: string | null = null;
  let allowDowngrade = false;
  let availableVersion: string | null = null;
  let downloadedVersion: string | null = null;

  const readBuild = async (version: string) => {
    const raw = await runtime.readBuildStatus();
    const build = raw === null ? null : decodeBuildStatus(raw);
    if (build === null || build.version !== version) {
      throw new Error(`The update helper has no build for ${version}.`);
    }
    return build;
  };

  const waitForBuild = async (signal: AbortSignal) => {
    const version = availableVersion;
    if (version === null) throw new Error("No new nightly is available to build.");
    // Returns once the agent has claimed the request, or finds the build already staged.
    await runtime.runHelper(["request-build", version]);
    let lastPercent: number | null = null;
    while (!signal.aborted) {
      const build = await readBuild(version);
      if (build.state === "ready") {
        downloadedVersion = version;
        events.emit("download-progress", { percent: 100 });
        events.emit("update-downloaded", { version });
        return;
      }
      if (build.state === "failed") {
        throw new Error(build.message ?? `Building ${version} with your changes failed.`);
      }
      if (runtime.now() - Date.parse(build.updatedAt) > STALLED_AFTER_MS) {
        throw new Error(
          `The update build stopped responding during "${build.phase ?? "setup"}". Click to retry.`,
        );
      }
      if (build.percent !== lastPercent) {
        lastPercent = build.percent;
        events.emit("download-progress", { percent: build.percent });
      }
      await runtime.sleep(POLL_INTERVAL_MS);
    }
  };

  return ElectronUpdater.ElectronUpdater.of({
    setFeedURL: Effect.fn("CustomNightlyUpdater.setFeedURL")(function () {
      return Effect.void;
    }),
    setAutoDownload: Effect.fn("CustomNightlyUpdater.setAutoDownload")(function () {
      return Effect.void;
    }),
    setAutoInstallOnAppQuit: Effect.fn("CustomNightlyUpdater.setAutoInstallOnAppQuit")(function () {
      return Effect.void;
    }),
    setChannel: Effect.fn("CustomNightlyUpdater.setChannel")(function (value) {
      return Effect.sync(() => {
        channel = value;
      });
    }),
    setAllowPrerelease: Effect.fn("CustomNightlyUpdater.setAllowPrerelease")(function () {
      return Effect.void;
    }),
    allowDowngrade: Effect.sync(() => allowDowngrade),
    setAllowDowngrade: Effect.fn("CustomNightlyUpdater.setAllowDowngrade")(function (value) {
      return Effect.sync(() => {
        allowDowngrade = value;
      });
    }),
    setFullChangelog: Effect.fn("CustomNightlyUpdater.setFullChangelog")(function () {
      return Effect.void;
    }),
    setDisableDifferentialDownload: Effect.fn(
      "CustomNightlyUpdater.setDisableDifferentialDownload",
    )(function () {
      return Effect.void;
    }),
    checkForUpdates: Effect.tryPromise({
      try: async () => {
        events.emit("checking-for-update");
        const status = decodeHelperStatus(
          await runtime.runHelper(["status", "--json", "--current", runtime.appVersion]),
        );
        if (!status.updateAvailable) {
          events.emit("update-not-available", { version: status.current });
          return;
        }
        availableVersion = status.latest;
        events.emit("update-available", {
          version: status.latest,
          releaseNotes: status.releaseNotes,
        });
      },
      catch: (cause) => new CustomNightlyCheckError({ channel, cause }),
    }),
    downloadUpdate: Effect.tryPromise({
      try: (signal) => waitForBuild(signal),
      catch: (cause) => new CustomNightlyBuildError({ channel, cause }),
    }),
    quitAndInstall: Effect.fn("CustomNightlyUpdater.quitAndInstall")(function ({
      isSilent,
      isForceRunAfter,
    }) {
      return Effect.tryPromise({
        try: async () => {
          const version = downloadedVersion;
          if (version === null) throw new Error("No update has been built yet.");
          // Returns once the agent is waiting for this process to exit.
          await runtime.runHelper(["request-install", version, "--pid", String(runtime.pid)]);
          runtime.quitApp();
        },
        catch: (cause) =>
          new CustomNightlyInstallError({ channel, isSilent, isForceRunAfter, cause }),
      });
    }),
    on: Effect.fn("CustomNightlyUpdater.on")(function (eventName, listener) {
      const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          events.on(eventName, untypedListener);
        }),
        () =>
          Effect.sync(() => {
            events.removeListener(eventName, untypedListener);
          }),
      ).pipe(Effect.asVoid);
    }),
  });
}

function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .findLast((line) => line.length > 0) ?? ""
  );
}

const helperScript =
  process.env.T3CODE_CUSTOM_UPDATE_SCRIPT ??
  NodePath.join(NodeOS.homedir(), ".t3", "custom-build", "update-nightly.py");

export const layer = Layer.effect(
  ElectronUpdater.ElectronUpdater,
  Effect.sync(() =>
    makeCustomNightlyUpdater({
      appVersion: Electron.app.getVersion(),
      runHelper: (args) =>
        new Promise((resolve, reject) => {
          NodeChildProcess.execFile(
            "/usr/bin/python3",
            ["-I", helperScript, ...args],
            { timeout: HELPER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                reject(new Error(lastLine(stderr) || error.message));
                return;
              }
              resolve(stdout);
            },
          );
        }),
      readBuildStatus: () =>
        NodeFSP.readFile(
          NodePath.join(NodePath.dirname(helperScript), "state", "status.json"),
          "utf8",
        ).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
      quitApp: () => Electron.app.quit(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      pid: process.pid,
    }),
  ),
);
