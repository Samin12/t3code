import { describe, expect, it } from "vite-plus/test";
import { encodeRequest } from "./protocol.ts";

describe("Swift mailbox protocol", () => {
  it("encodes uppercase UUIDs and seconds since Apple's 2001 reference date", () => {
    expect(
      encodeRequest(
        "01234567-abcd-4abc-8def-0123456789ab",
        "key",
        { key: "cmd+space" },
        978307215250,
      ),
    ).toEqual({
      id: "01234567-ABCD-4ABC-8DEF-0123456789AB",
      action: "key",
      arguments: { key: "cmd+space" },
      deadline: 15.25,
    });
    expect(() => encodeRequest("bad", "status", {}, 0)).toThrow("UUID");
  });
});
