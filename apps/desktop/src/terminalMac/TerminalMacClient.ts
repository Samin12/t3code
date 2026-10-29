// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Local VM lifecycle and asynchronous guest frame transport.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeTimersPromises from "node:timers/promises";
import type {
  TerminalMacEvent,
  TerminalMacFrame,
  TerminalMacRequest,
  TerminalMacResponse,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { callMailbox, MailboxTimeout, readMailboxFile } from "./Mailbox.ts";

const installCommand =
  "curl -fsSL https://github.com/govijr/terminal-mac/releases/latest/download/get.sh | bash";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isMailboxTimeout = Schema.is(MailboxTimeout);

async function findBinary() {
  const candidates = [
    NodePath.join(NodeOS.homedir(), ".local/bin/terminal-mac"),
    ...(process.env.PATH ?? "")
      .split(NodePath.delimiter)
      .filter(Boolean)
      .map((dir) => NodePath.join(dir, "terminal-mac")),
  ];
  for (const candidate of candidates) {
    try {
      await NodeFSP.access(candidate, NodeFS.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function runCli(binary: string, args: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = NodeChildProcess.spawn(binary, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("terminal-mac did not respond."));
    }, 40_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 4 * 1024 * 1024) {
        child.kill();
        reject(new Error("terminal-mac output is too large."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `terminal-mac exited with ${code}.`));
        return;
      }
      try {
        const value: unknown = JSON.parse(stdout);
        if (Array.isArray(value)) {
          resolve({ machines: JSON.stringify(value) });
          return;
        }
        if (
          !value ||
          typeof value !== "object" ||
          !Object.values(value).every((item) => typeof item === "string")
        )
          throw new Error("Invalid terminal-mac response.");
        resolve(value as Record<string, string>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export class TerminalMacClient {
  private readonly directory = NodePath.join(
    process.env.TERMINAL_MAC_HOME ??
      NodePath.join(NodeOS.homedir(), "Library/Application Support/terminal-mac"),
    "machines/default",
  );
  private readonly listeners = new Set<(event: TerminalMacEvent) => void>();
  private readonly subscribers = new Set<string>();
  private controller: AbortController | null = null;
  private stopping: ReturnType<typeof setTimeout> | undefined;
  private sequence = -1;
  private status: TerminalMacResponse = {
    state: "not-created",
    machineExists: false,
    installed: false,
  };
  private checking: Promise<TerminalMacResponse> | null = null;
  private lifecycle: Promise<TerminalMacResponse> | null = null;
  private inputQueue: Promise<unknown> = Promise.resolve();

  listen(listener: (event: TerminalMacEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: TerminalMacEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private setStatus(status: TerminalMacResponse) {
    const changed = JSON.stringify(status) !== JSON.stringify(this.status);
    this.status = status;
    if (changed) this.emit({ type: "state", status });
    return status;
  }
  subscribe(id: string) {
    this.subscribers.add(id);
    clearTimeout(this.stopping);
    this.stopping = undefined;
    this.sequence = -1;
    this.emit({ type: "state", status: this.status });
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    void this.stream(controller)
      .catch((error) => {
        if (!controller.signal.aborted) this.emit({ type: "error", message: message(error) });
      })
      .finally(() => {
        if (this.controller !== controller) return;
        this.controller = null;
        const next = this.subscribers.values().next();
        if (!next.done) this.subscribe(next.value);
      });
  }
  unsubscribe(id: string) {
    this.subscribers.delete(id);
    if (this.subscribers.size || this.stopping) return;
    this.stopping = setTimeout(() => {
      this.stopping = undefined;
      this.controller?.abort();
    }, 15_000);
  }
  clearSubscriptions() {
    for (const id of this.subscribers) this.unsubscribe(id);
  }
  dispose() {
    clearTimeout(this.stopping);
    this.controller?.abort();
    this.subscribers.clear();
    this.listeners.clear();
  }

  private inspect(): Promise<TerminalMacResponse> {
    if (this.checking) return this.checking;
    this.checking = this.inspectNow().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  private async inspectNow(): Promise<TerminalMacResponse> {
    const binary = await findBinary();
    let machineExists = false,
      installed = false;
    try {
      const machine: unknown = JSON.parse(
        await NodeFSP.readFile(NodePath.join(this.directory, "machine.json"), "utf8"),
      );
      machineExists = true;
      installed =
        !!machine &&
        typeof machine === "object" &&
        "installed" in machine &&
        machine.installed === true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!binary)
      return { state: "not-installed", machineExists, installed, message: installCommand };
    if (!machineExists) return { state: "not-created", machineExists, installed };
    if (!installed)
      return {
        state: "starting",
        machineExists,
        installed,
        message: "macOS installation is still in progress.",
      };
    const values = await runCli(binary, ["status", "default"]);
    if (values.state === "stopped") return { state: "stopped", machineExists, installed, values };
    if (values.state !== "running") return { state: "starting", machineExists, installed, values };
    try {
      const grants = await callMailbox(
        NodePath.join(this.directory, "exchange"),
        "status",
        {},
        async (value) => value,
        undefined,
        1500,
      );
      const permissions = grants.screenRecording === "true" && grants.accessibility === "true";
      return {
        state: permissions ? "running" : "needs-permissions",
        machineExists,
        installed,
        values: grants,
        ...(!permissions
          ? {
              message:
                "Allow Screen Recording and Accessibility for TerminalMacGuest inside the VM.",
            }
          : {}),
      };
    } catch (error) {
      return {
        state: isMailboxTimeout(error) && !error.pickedUp ? "needs-sign-in" : "running",
        machineExists,
        installed,
        message: message(error),
      };
    }
  }

  request(input: TerminalMacRequest): Promise<TerminalMacResponse> {
    if (input.action === "status")
      return this.inspect().then((status) =>
        this.lifecycle ? this.status : this.setStatus(status),
      );
    if (["start", "open-window", "stop", "hide", "list"].includes(input.action)) {
      if (this.lifecycle) return this.lifecycle;
      this.lifecycle = this.runLifecycle(input.action).finally(() => {
        this.lifecycle = null;
      });
      return this.lifecycle;
    }
    const next = this.inputQueue.then(async () => {
      const values = await callMailbox(
        NodePath.join(this.directory, "exchange"),
        input.action,
        { ...input.arguments },
        async (value) => value,
        undefined,
        6000,
      );
      return { ...this.status, values };
    });
    this.inputQueue = next.catch(() => undefined);
    return next;
  }
  private async runLifecycle(action: string) {
    const binary = await findBinary();
    if (!binary)
      return this.setStatus({ ...this.status, state: "not-installed", message: installCommand });
    const status = await this.inspect();
    if (action !== "list" && !status.machineExists) return this.setStatus(status);
    if (action === "start" || action === "open-window")
      this.setStatus({ ...status, state: "starting" });
    const args =
      action === "open-window"
        ? ["start", "default", "--window"]
        : action === "list"
          ? ["ls"]
          : [action, "default"];
    try {
      const values = await runCli(binary, args);
      this.sequence = -1;
      return this.setStatus({
        ...(await this.inspect()),
        ...(action === "list" ? { values } : {}),
      });
    } catch (error) {
      this.setStatus({ ...status, message: message(error) });
      throw error;
    }
  }

  private async frame(signal: AbortSignal): Promise<TerminalMacFrame | null> {
    return callMailbox(
      NodePath.join(this.directory, "exchange"),
      "screenshot",
      {
        format: "bgra-lz4",
        since: String(this.sequence),
        wait: "500",
        maxWidth: "1280",
        maxHeight: "800",
      },
      async (values, id) => {
        if (values.unchanged === "true") return null;
        if (values.image !== `image-${id}.bin` && values.image !== `image-${id}.png`)
          throw new Error("Invalid guest image filename.");
        const data = await readMailboxFile(
          NodePath.join(this.directory, "exchange"),
          values.image,
          64 * 1024 * 1024,
        );
        if (!data) throw new Error("Guest image is missing.");
        const width = Number(values.width),
          height = Number(values.height);
        const pointWidth = Number(values.pointWidth ?? values.width),
          pointHeight = Number(values.pointHeight ?? values.height);
        if (
          ![width, height, pointWidth, pointHeight].every(
            (value) => Number.isSafeInteger(value) && value >= 1 && value <= 8192,
          )
        )
          throw new Error("Invalid guest image dimensions.");
        if (values.image.endsWith(".png"))
          return {
            format: "png",
            data,
            width,
            height,
            bytesPerRow: width * 4,
            pointWidth,
            pointHeight,
            sequence: -1,
          };
        const stride = Number(values.bytesPerRow);
        if (!Number.isSafeInteger(stride) || stride < width * 4 || stride > width * 4 + 1024)
          throw new Error("Invalid guest image stride.");
        const sequence = Number(values.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 0)
          throw new Error("Invalid guest image sequence.");
        this.sequence = sequence;
        // Decoding happens in the panel so the main process only moves compressed bytes.
        return {
          format: "bgra-lz4",
          data,
          width,
          height,
          bytesPerRow: stride,
          pointWidth,
          pointHeight,
          sequence,
        };
      },
      signal,
      2000,
    );
  }
  private async stream(controller: AbortController) {
    const signal = controller.signal;
    let checkedAt = 0;
    while (!signal.aborted) {
      try {
        if (Date.now() - checkedAt > 5000 && !this.lifecycle) {
          const status = await this.inspect();
          this.setStatus(
            status.state === "running" && !status.message && this.status.state === "live"
              ? { ...status, state: "live" }
              : status,
          );
          checkedAt = Date.now();
        }
        if (
          !["running", "live", "needs-sign-in", "needs-permissions"].includes(this.status.state)
        ) {
          await NodeTimersPromises.setTimeout(1000, undefined, { signal });
          continue;
        }
        const frame = await this.frame(signal);
        if (signal.aborted) break;
        if (frame) this.emit({ type: "frame", frame });
        if (this.status.state !== "needs-permissions")
          this.setStatus({ ...this.status, state: "live", message: undefined });
        if (frame?.format === "png")
          await NodeTimersPromises.setTimeout(120, undefined, { signal });
      } catch (error) {
        if (signal.aborted) break;
        if (isMailboxTimeout(error))
          this.setStatus({
            ...this.status,
            state: error.pickedUp ? "running" : "needs-sign-in",
            message: error.message,
          });
        else {
          this.setStatus({
            ...this.status,
            state: this.status.state === "live" ? "running" : this.status.state,
            message: message(error),
          });
          this.emit({ type: "error", message: message(error) });
        }
        this.sequence = -1;
        await NodeTimersPromises.setTimeout(700, undefined, { signal });
      }
    }
  }
}
