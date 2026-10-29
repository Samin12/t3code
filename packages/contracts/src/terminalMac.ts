import * as Schema from "effect/Schema";

export const TerminalMacRequest = Schema.Struct({
  action: Schema.Literals([
    "status",
    "start",
    "open-window",
    "hide",
    "stop",
    "list",
    "click",
    "move",
    "drag",
    "scroll",
    "type",
    "key",
  ]),
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type TerminalMacRequest = typeof TerminalMacRequest.Type;
export const TerminalMacState = Schema.Literals([
  "not-installed",
  "not-created",
  "stopped",
  "starting",
  "running",
  "needs-sign-in",
  "needs-permissions",
  "live",
]);
export type TerminalMacState = typeof TerminalMacState.Type;
export const TerminalMacResponse = Schema.Struct({
  state: TerminalMacState,
  machineExists: Schema.Boolean,
  installed: Schema.Boolean,
  message: Schema.optional(Schema.String),
  values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type TerminalMacResponse = typeof TerminalMacResponse.Type;
export type TerminalMacFrame = {
  /** Compressed BGRA rows the panel decodes, or a PNG from older guest helpers. */
  format: "bgra-lz4" | "png";
  data: Uint8Array;
  width: number;
  height: number;
  bytesPerRow: number;
  pointWidth: number;
  pointHeight: number;
  sequence: number;
};
export type TerminalMacEvent =
  | { type: "frame"; frame: TerminalMacFrame }
  | { type: "state"; status: TerminalMacResponse }
  | { type: "error"; message: string };
