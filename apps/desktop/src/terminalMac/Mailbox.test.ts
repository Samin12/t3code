// @effect-diagnostics nodeBuiltinImport:off -- Exercises mailbox files in isolated temporary directories.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { callMailbox, MailboxTimeout, readMailboxFile } from "./Mailbox.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFSP>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const rename = (await vi.importActual<typeof NodeFSP>("node:fs/promises")).rename;
let directory: string;
beforeEach(async () => {
  vi.mocked(NodeFSP.rename).mockImplementation(rename);
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-terminal-mac-"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

describe("guest mailbox", () => {
  it("publishes a private request atomically, consumes its image, and removes exchanged files", async () => {
    vi.mocked(NodeFSP.rename).mockImplementation(async (from, to) => {
      await rename(from, to);
      const path = String(to);
      const request = JSON.parse(await NodeFSP.readFile(path, "utf8"));
      expect(NodePath.basename(path)).toBe(`request-${request.id}.json`);
      expect(request.id).toMatch(/^[A-F0-9-]{36}$/);
      expect((await NodeFSP.stat(path)).mode & 0o777).toBe(0o600);
      expect(request.action).toBe("screenshot");
      expect(request.arguments).toEqual({ format: "bgra-lz4" });
      await NodeFSP.unlink(path);
      await NodeFSP.writeFile(
        NodePath.join(directory, `image-${request.id}.png`),
        new Uint8Array([1, 2, 3]),
      );
      await NodeFSP.writeFile(
        NodePath.join(directory, `reply-${request.id}.json`),
        JSON.stringify({ id: request.id, ok: true, values: { image: `image-${request.id}.png` } }),
      );
    });
    const bytes = await callMailbox(
      directory,
      "screenshot",
      { format: "bgra-lz4" },
      async (values) => readMailboxFile(directory, values.image!, 64),
    );
    expect([...bytes!]).toEqual([1, 2, 3]);
    expect(await NodeFSP.readdir(directory)).toEqual([]);
  });
  it("distinguishes an unread request from a picked-up request at the deadline", async () => {
    await expect(
      callMailbox(directory, "status", {}, async (value) => value, undefined, 0),
    ).rejects.toMatchObject({ pickedUp: false });
    expect(await NodeFSP.readdir(directory)).toEqual([]);
    vi.mocked(NodeFSP.rename).mockImplementation(async (from, to) => {
      await rename(from, to);
      await NodeFSP.unlink(to);
    });
    await expect(
      callMailbox(directory, "status", {}, async (value) => value, undefined, 0),
    ).rejects.toMatchObject({ pickedUp: true });
    expect(new MailboxTimeout({ pickedUp: true }).message).toContain("busy");
    expect(await NodeFSP.readdir(directory)).toEqual([]);
  });
  it("rejects mismatched replies and cleans up after failure or cancellation", async () => {
    vi.mocked(NodeFSP.rename).mockImplementation(async (from, to) => {
      await rename(from, to);
      const name = NodePath.basename(String(to)).replace("request-", "reply-");
      await NodeFSP.writeFile(
        NodePath.join(directory, name),
        JSON.stringify({ id: "WRONG", ok: true, values: {} }),
      );
    });
    await expect(callMailbox(directory, "status", {}, async (value) => value)).rejects.toThrow(
      "Invalid guest reply",
    );
    await expect(
      callMailbox(directory, "status", {}, async (value) => value, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(await NodeFSP.readdir(directory)).toEqual([]);
  });
  it("rejects symlinks, oversized replies, and image path traversal", async () => {
    const name = "reply-ABC.json";
    await NodeFSP.writeFile(NodePath.join(directory, "target"), "{}");
    await NodeFSP.symlink(NodePath.join(directory, "target"), NodePath.join(directory, name));
    await expect(readMailboxFile(directory, name, 1024)).rejects.toThrow();
    await NodeFSP.unlink(NodePath.join(directory, name));
    await NodeFSP.writeFile(NodePath.join(directory, name), "oversized");
    await expect(readMailboxFile(directory, name, 1)).rejects.toThrow("Invalid mailbox file");
    await expect(readMailboxFile(directory, "../image-ABC.png", 1024)).rejects.toThrow("filename");
  });
});
