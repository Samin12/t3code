// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Supported CLI subprocess and atomic local link-file adapter, also exercised without Electron.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type { HeptabaseBinding, HeptabaseRequest, HeptabaseResponse } from "@t3tools/contracts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Document = { workspaceId: string | null; links: Record<string, HeptabaseBinding> };
type Cli = (args: string[]) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Heptabase response.");
  return value as Record<string, unknown>;
}

/** Uses only the supported CLI. It never reads Heptabase's app storage. */
export function makeHeptabaseCli(binary: string): Cli {
  return async (args) => {
    const { stdout } = await execFile(binary, args, {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (args[0] === "--version") return stdout.trim();
    const result = record(JSON.parse(stdout));
    if (
      result.status === "failed" ||
      result.operationFailureReasonCode ||
      result.failureReasonCode
    ) {
      throw new Error(
        `Heptabase: ${String(result.operationFailureReasonCode ?? result.failureReasonCode ?? "operation failed")}`,
      );
    }
    return result;
  };
}

/** Persistent thread links are independent of whether their panel is open. */
export class HeptabaseClient {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly directory: string;
  private readonly cli: Cli;
  constructor(directory: string, cli: Cli) {
    this.directory = directory;
    this.cli = cli;
  }

  request(input: HeptabaseRequest): Promise<HeptabaseResponse> {
    // Serialize read-modify-write and creation: a double click must never create two boards.
    const next = this.queue.then(() => this.execute(input));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Document> {
    try {
      const raw = record(
        JSON.parse(await NodeFSP.readFile(NodePath.join(this.directory, "links.json"), "utf8")),
      );
      const links = record(raw.links);
      for (const value of Object.values(links)) {
        const link = record(value);
        if (
          typeof link.boardId !== "string" ||
          !uuid.test(link.boardId) ||
          typeof link.title !== "string" ||
          typeof link.linkedAt !== "string"
        )
          throw new Error("Invalid saved Heptabase link.");
      }
      if (
        raw.workspaceId !== null &&
        (typeof raw.workspaceId !== "string" || !uuid.test(raw.workspaceId))
      )
        throw new Error("Invalid Heptabase workspace.");
      return raw as unknown as Document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { workspaceId: null, links: {} };
      throw error;
    }
  }

  private async save(document: Document) {
    await NodeFSP.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = NodePath.join(this.directory, "links.json");
    const temporary = `${target}.tmp`;
    await NodeFSP.writeFile(temporary, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
    await NodeFSP.rename(temporary, target);
  }

  private async checkedCli(args: string[]) {
    const version = await this.cli(["--version"]);
    if (typeof version !== "string" || !/^0\.(6|7)\./.test(version))
      throw new Error(
        "This integration requires Heptabase CLI 0.6.x or 0.7.x. Update the integration or Heptabase before continuing.",
      );
    return record(await this.cli(args));
  }

  private async execute(input: HeptabaseRequest): Promise<HeptabaseResponse> {
    const document = await this.read();
    const key =
      "ref" in input ? JSON.stringify([input.ref.environmentId, input.ref.threadId]) : null;
    const binding = key ? (document.links[key] ?? null) : null;
    const state = { binding, workspaceId: document.workspaceId };
    switch (input.action) {
      case "get":
        return state;
      case "workspace":
        if (!uuid.test(input.workspaceId)) throw new Error("Invalid workspace ID.");
        document.workspaceId = input.workspaceId;
        await this.save(document);
        return { ...state, workspaceId: input.workspaceId };
      case "list": {
        const result = await this.checkedCli([
          "whiteboard",
          "list",
          "--name-filter",
          input.query.slice(0, 200),
          "--offset",
          String(Math.max(0, Math.trunc(input.offset))),
          "--limit",
          "30",
        ]);
        if (!Array.isArray(result.whiteboards) || typeof result.total !== "number")
          throw new Error("Invalid whiteboard list.");
        const boards = result.whiteboards.map((value) => {
          const board = record(value);
          if (
            typeof board.id !== "string" ||
            !uuid.test(board.id) ||
            typeof board.name !== "string"
          )
            throw new Error("Invalid whiteboard.");
          return { id: board.id, name: board.name };
        });
        return { ...state, boards, total: result.total };
      }
      case "context": {
        if (!binding) return state;
        const result = await this.checkedCli([
          "whiteboard",
          "read",
          binding.boardId,
          "--mode",
          "structure",
        ]);
        if (typeof result.content !== "string")
          throw new Error("Heptabase did not return board context.");
        return { ...state, context: result.content.slice(0, 16_000) };
      }
      case "unlink":
        delete document.links[key!];
        await this.save(document);
        return { ...state, binding: null };
      case "create": {
        if (binding) return state;
        const title = input.title.trim().slice(0, 200);
        if (!title) throw new Error("Give the whiteboard a name.");
        // Ensure the link directory is writable before creating an irreversible remote resource.
        await this.save(document);
        const result = await this.checkedCli(["whiteboard", "create", "--title", title]);
        if (typeof result.whiteboardId !== "string" || !uuid.test(result.whiteboardId))
          throw new Error("Heptabase did not return a whiteboard ID.");
        document.links[key!] = {
          boardId: result.whiteboardId,
          title,
          linkedAt: new Date().toISOString(),
        };
        try {
          await this.save(document);
        } catch {
          throw new Error(
            `Created whiteboard ${result.whiteboardId}, but could not save its session link. Use Link existing to recover it; do not create another.`,
          );
        }
        return { ...state, binding: document.links[key!]! };
      }
      case "link": {
        if (!uuid.test(input.boardId)) throw new Error("Invalid whiteboard ID.");
        await this.checkedCli(["whiteboard", "read", input.boardId, "--mode", "structure"]);
        document.links[key!] = {
          boardId: input.boardId,
          title: input.title.slice(0, 200),
          linkedAt: new Date().toISOString(),
        };
        await this.save(document);
        return { ...state, binding: document.links[key!]! };
      }
    }
  }
}
