// @effect-diagnostics nodeBuiltinImport:off -- Filesystem persistence tests use isolated temporary directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HeptabaseClient } from "./HeptabaseClient.ts";

const id = "93e728e4-c8a0-403d-b31d-54b6f5dd5b73";
const ref = { environmentId: "host-a", threadId: "thread-a" };
let directory: string;
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-heptabase-"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});
const cli = (version = "0.6.0") =>
  vi.fn(async (args: string[]): Promise<unknown> => {
    if (args[0] === "--version") return version;
    if (args[1] === "create") return { status: "created", whiteboardId: id };
    if (args[1] === "read") return { content: "Live whiteboard structure" };
    return { whiteboards: [{ id, name: "A board" }], total: 1 };
  });

describe("Heptabase thread binding", () => {
  it("creates once under concurrent requests and restores the binding after restart", async () => {
    const run = cli();
    const client = new HeptabaseClient(directory, run);
    const request = { action: "create" as const, ref, title: "Our board" };
    const [first, second] = await Promise.all([client.request(request), client.request(request)]);
    expect(first.binding?.boardId).toBe(id);
    expect(second).toEqual(first);
    expect(run.mock.calls.filter(([args]) => args[1] === "create")).toHaveLength(1);
    const restarted = new HeptabaseClient(directory, run);
    expect(await restarted.request({ action: "get", ref })).toEqual(first);
    expect((await restarted.request({ action: "context", ref })).context).toBe(
      "Live whiteboard structure",
    );
  });
  it("isolates both threads and environments; unlink keeps the source board", async () => {
    const run = cli();
    const client = new HeptabaseClient(directory, run);
    await client.request({ action: "link", ref, boardId: id, title: "Board" });
    expect(
      (await client.request({ action: "get", ref: { ...ref, threadId: "thread-b" } })).binding,
    ).toBeNull();
    expect(
      (await client.request({ action: "get", ref: { ...ref, environmentId: "host-b" } })).binding,
    ).toBeNull();
    await client.request({ action: "unlink", ref });
    expect((await client.request({ action: "get", ref })).binding).toBeNull();
    expect(run.mock.calls.every(([args]) => args[0] === "--version" || args[1] === "read")).toBe(
      true,
    );
  });
  it("uses literal CLI arguments for board names and paginates searches", async () => {
    const run = cli();
    const client = new HeptabaseClient(directory, run);
    const title = 'Board $(touch /tmp/no) `whoami` "quoted"';
    await client.request({ action: "create", ref, title });
    expect(run).toHaveBeenCalledWith(["whiteboard", "create", "--title", title]);
    const result = await client.request({ action: "list", query: "Course", offset: 30 });
    expect(result.boards?.[0]?.id).toBe(id);
    expect(run).toHaveBeenLastCalledWith([
      "whiteboard",
      "list",
      "--name-filter",
      "Course",
      "--offset",
      "30",
      "--limit",
      "30",
    ]);
  });
  it("accepts the installed 0.7 CLI for listing boards", async () => {
    const run = cli("0.7.0");
    const client = new HeptabaseClient(directory, run);
    const result = await client.request({ action: "list", query: "", offset: 0 });
    expect(result.boards?.[0]?.id).toBe(id);
    expect(run).toHaveBeenCalledWith(["--version"]);
  });
  it("keeps the saved link on offline failures and never supplies cached context", async () => {
    const run = cli();
    const client = new HeptabaseClient(directory, run);
    await client.request({ action: "link", ref, boardId: id, title: "Board" });
    run.mockRejectedValue(new Error("CLI is offline"));
    await expect(client.request({ action: "context", ref })).rejects.toThrow("offline");
    expect((await client.request({ action: "get", ref })).binding?.boardId).toBe(id);
    await client.request({ action: "unlink", ref });
    expect((await client.request({ action: "context", ref })).binding).toBeNull();
  });
  it("refuses an incompatible CLI and invalid IDs before mutations", async () => {
    const run = vi.fn(async () => "0.8.0");
    const client = new HeptabaseClient(directory, run);
    await expect(client.request({ action: "create", ref, title: "Board" })).rejects.toThrow(
      "0.6.x or 0.7.x",
    );
    expect(run).toHaveBeenCalledTimes(1);
    await expect(
      client.request({ action: "link", ref, boardId: "--bad", title: "Board" }),
    ).rejects.toThrow("Invalid");
    expect((await client.request({ action: "get", ref })).binding).toBeNull();
  });
  it("does not overwrite corrupt saved links", async () => {
    await NodeFSP.writeFile(NodePath.join(directory, "links.json"), "broken");
    const run = cli();
    await expect(
      new HeptabaseClient(directory, run).request({ action: "create", ref, title: "Board" }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(await NodeFSP.readFile(NodePath.join(directory, "links.json"), "utf8")).toBe("broken");
  });
});
