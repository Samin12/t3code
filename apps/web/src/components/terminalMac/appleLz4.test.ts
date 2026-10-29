import { describe, expect, it } from "vite-plus/test";
import { bgraToRgba, decodeAppleLz4, decodeLz4Block } from "./appleLz4";

function block(magic: string, decoded: number, bytes: number[], compressed = true) {
  const output = new Uint8Array((compressed ? 12 : 8) + bytes.length);
  output.set(new TextEncoder().encode(magic));
  const view = new DataView(output.buffer);
  view.setUint32(4, decoded, true);
  if (compressed) view.setUint32(8, bytes.length, true);
  output.set(bytes, compressed ? 12 : 8);
  return output;
}
const end = new TextEncoder().encode("bv4$");

describe("Apple LZ4 frames", () => {
  it("decodes compressed and uncompressed blocks in one Apple stream", () => {
    const compressed = block("bv41", 9, [0x32, 65, 66, 67, 3, 0]);
    const raw = block("bv4-", 2, [68, 69], false);
    const input = new Uint8Array([...compressed, ...raw, ...end]);
    expect(new TextDecoder().decode(decodeAppleLz4(input, 11))).toBe("ABCABCABCDE");
    expect(() => decodeAppleLz4(input, 10)).toThrow();
    expect(() => decodeAppleLz4(input.subarray(0, -1), 11)).toThrow();
    expect(() => decodeAppleLz4(new Uint8Array([...input, 0]), 11)).toThrow();
    expect(() => decodeAppleLz4(new TextEncoder().encode("junk"), 11)).toThrow();
  });
  it("preserves the prior 64 KiB dictionary across Apple block boundaries", () => {
    const literal = block("bv4-", 3, [65, 66, 67], false);
    const match = block("bv41", 6, [0x02, 3, 0]);
    expect(
      new TextDecoder().decode(decodeAppleLz4(new Uint8Array([...literal, ...match, ...end]), 9)),
    ).toBe("ABCABCABC");
    expect(() => decodeLz4Block(new Uint8Array([0x02, 3, 0]), 6)).toThrow("match");
  });
  it("handles overlapping matches and extended literal and match lengths", () => {
    expect([...decodeLz4Block(new Uint8Array([0x15, 97, 1, 0]), 10)]).toEqual(Array(10).fill(97));
    expect(decodeLz4Block(new Uint8Array([0xf0, 1, ...Array<number>(16).fill(42)]), 16)).toEqual(
      new Uint8Array(16).fill(42),
    );
    expect(decodeLz4Block(new Uint8Array([0x1f, 97, 1, 0, 2]), 22)).toEqual(
      new Uint8Array(22).fill(97),
    );
    for (const bytes of [[0xf0], [0x10], [0x10, 97, 0], [0x10, 97, 0, 0], [0x10, 97, 2, 0]])
      expect(() => decodeLz4Block(new Uint8Array(bytes), 5)).toThrow();
  });
  it("swizzles BGRA and drops row padding without changing alpha", () => {
    expect([
      ...bgraToRgba(
        new Uint8Array([1, 2, 3, 4, 99, 99, 99, 99, 5, 6, 7, 8, 99, 99, 99, 99]),
        1,
        2,
        8,
      ),
    ]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
    expect(() => bgraToRgba(new Uint8Array(4), 1, 2, 4)).toThrow();
    expect(() => decodeAppleLz4(end, 1024 * 1024 * 1024)).toThrow();
  });
});
