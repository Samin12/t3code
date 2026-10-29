// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Async adapter for the Swift guest's file mailbox.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeTimersPromises from "node:timers/promises";
import * as Schema from "effect/Schema";
import { encodeRequest } from "./protocol.ts";

export class MailboxTimeout extends Schema.TaggedError<MailboxTimeout>()("MailboxTimeout", {
  pickedUp: Schema.Boolean,
}) {
  override get message() {
    return this.pickedUp
      ? "The guest helper is busy. Reopen TerminalMacGuest in the VM."
      : "Sign in to the virtual Mac and open TerminalMacGuest.";
  }
}

export async function readMailboxFile(
  directory: string,
  name: string,
  limit: number,
): Promise<Buffer | null> {
  if (!/^(?:request|reply|image)-[A-F0-9-]+\.(?:json|bin|png)$/.test(name))
    throw new Error("Invalid mailbox filename.");
  let file;
  try {
    file = await NodeFSP.open(
      NodePath.join(directory, name),
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw new Error("Invalid mailbox file.");
    const data = await file.readFile();
    if (data.length > limit) throw new Error("Mailbox file exceeded size limit.");
    return data;
  } finally {
    await file.close();
  }
}

export async function callMailbox<T>(
  directory: string,
  action: string,
  args: Record<string, string>,
  consume: (values: Record<string, string>, id: string) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 2000,
): Promise<T> {
  const id = NodeCrypto.randomUUID().toUpperCase();
  const temporary = NodePath.join(directory, `.${id}.tmp`);
  const requestName = `request-${id}.json`,
    replyName = `reply-${id}.json`;
  const deadline = Date.now() + timeoutMs;
  const request = encodeRequest(id, action, args, deadline);
  const directoryStat = await NodeFSP.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error("Invalid mailbox directory.");
  try {
    signal?.throwIfAborted();
    await NodeFSP.writeFile(temporary, JSON.stringify(request), { mode: 0o600, flag: "wx" });
    await NodeFSP.rename(temporary, NodePath.join(directory, requestName));
    let interval = 2;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const data = await readMailboxFile(directory, replyName, 1024 * 1024);
      if (data) {
        const reply: unknown = JSON.parse(data.toString("utf8"));
        if (
          !reply ||
          typeof reply !== "object" ||
          !("id" in reply) ||
          reply.id !== id ||
          !("ok" in reply) ||
          typeof reply.ok !== "boolean" ||
          !("values" in reply) ||
          !reply.values ||
          typeof reply.values !== "object" ||
          Array.isArray(reply.values) ||
          !Object.values(reply.values).every((value) => typeof value === "string")
        )
          throw new Error("Invalid guest reply.");
        if (!reply.ok)
          throw new Error(
            "error" in reply && typeof reply.error === "string"
              ? reply.error
              : "Guest action failed.",
          );
        return await consume(reply.values as Record<string, string>, id);
      }
      await NodeTimersPromises.setTimeout(interval, undefined, { signal });
      interval = Math.min(25, interval * 1.5);
    }
    throw new MailboxTimeout({
      pickedUp: (await readMailboxFile(directory, requestName, 262144)) === null,
    });
  } finally {
    await Promise.all(
      [temporary, requestName, replyName, `image-${id}.bin`, `image-${id}.png`].map((name) =>
        NodeFSP.rm(NodePath.isAbsolute(name) ? name : NodePath.join(directory, name), {
          force: true,
        }),
      ),
    );
  }
}
