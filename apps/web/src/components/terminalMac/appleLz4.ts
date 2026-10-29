// Decodes Foundation's lz4 frames from the guest helper (bv41/bv4-/bv4$ blocks of BGRA rows).
const maxFrameBytes = 64 * 1024 * 1024;

export function decodeLz4Block(
  input: Uint8Array,
  size: number,
  history: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0 || size > maxFrameBytes)
    throw new Error("Invalid LZ4 size.");
  const output = new Uint8Array(size);
  let read = 0,
    written = 0;
  const length = (initial: number) => {
    let result = initial;
    if (initial === 15) {
      let extra: number;
      do {
        if (read >= input.length) throw new Error("Truncated LZ4 length.");
        extra = input[read++]!;
        result += extra;
      } while (extra === 255);
    }
    return result;
  };
  while (read < input.length) {
    const token = input[read++]!;
    const literals = length(token >>> 4);
    if (read + literals > input.length || written + literals > size)
      throw new Error("Invalid LZ4 literals.");
    output.set(input.subarray(read, read + literals), written);
    read += literals;
    written += literals;
    if (read === input.length) break;
    if (read + 2 > input.length) throw new Error("Truncated LZ4 offset.");
    const offset = input[read]! | (input[read + 1]! << 8);
    read += 2;
    const match = length(token & 15) + 4;
    if (offset === 0 || offset > written + history.length || written + match > size)
      throw new Error("Invalid LZ4 match.");
    for (let i = 0; i < match; i++) {
      const source = written + i - offset;
      output[written + i] = source < 0 ? history[history.length + source]! : output[source]!;
    }
    written += match;
  }
  if (written !== size) throw new Error("LZ4 decoded size mismatch.");
  return output;
}

export function decodeAppleLz4(input: Uint8Array, expectedSize: number): Uint8Array {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > maxFrameBytes)
    throw new Error("Invalid frame size.");
  const output = new Uint8Array(expectedSize);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let read = 0,
    written = 0;
  const uint32 = () => {
    if (read + 4 > input.length) throw new Error("Truncated Apple LZ4 stream.");
    const value = view.getUint32(read, true);
    read += 4;
    return value;
  };
  while (read < input.length) {
    const magic = uint32();
    if (magic === 0x24347662) {
      if (read !== input.length || written !== expectedSize)
        throw new Error("Apple LZ4 size mismatch.");
      return output;
    }
    if (magic !== 0x31347662 && magic !== 0x2d347662) throw new Error("Unknown Apple LZ4 block.");
    const decoded = uint32();
    const encoded = magic === 0x31347662 ? uint32() : decoded;
    if (written + decoded > expectedSize || read + encoded > input.length)
      throw new Error("Invalid Apple LZ4 block size.");
    const block = input.subarray(read, read + encoded);
    // Foundation LZ4 blocks share up to 64 KiB of preceding decoded bytes.
    output.set(
      magic === 0x31347662
        ? decodeLz4Block(block, decoded, output.subarray(Math.max(0, written - 65536), written))
        : block,
      written,
    );
    written += decoded;
    read += encoded;
  }
  throw new Error("Missing Apple LZ4 terminator.");
}

export function bgraToRgba(bytes: Uint8Array, width: number, height: number, stride: number) {
  if (
    ![width, height, stride].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    stride < width * 4 ||
    stride > width * 4 + 1024 ||
    bytes.length !== stride * height
  )
    throw new Error("Invalid BGRA frame.");
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = y * stride + x * 4,
        target = (y * width + x) * 4;
      output[target] = bytes[source + 2]!;
      output[target + 1] = bytes[source + 1]!;
      output[target + 2] = bytes[source]!;
      output[target + 3] = bytes[source + 3]!;
    }
  }
  return output;
}
