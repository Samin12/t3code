import type { TerminalMacEvent, TerminalMacRequest, TerminalMacResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { TerminalMacClient } from "./TerminalMacClient.ts";

export class TerminalMacError extends Schema.TaggedError<TerminalMacError>()("TerminalMacError", {
  detail: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.detail;
  }
}
export class TerminalMac extends Context.Service<
  TerminalMac,
  {
    readonly request: (
      input: TerminalMacRequest,
    ) => Effect.Effect<TerminalMacResponse, TerminalMacError>;
    readonly subscribe: (id: string) => Effect.Effect<void>;
    readonly unsubscribe: (id: string) => Effect.Effect<void>;
    readonly clearSubscriptions: Effect.Effect<void>;
    readonly listen: (
      listener: (event: TerminalMacEvent) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/terminalMac/TerminalMac") {}

export const layer = Layer.effect(
  TerminalMac,
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new TerminalMacClient()),
      (client) => Effect.sync(() => client.dispose()),
    );
    return TerminalMac.of({
      request: Effect.fn("TerminalMac.request")((input: TerminalMacRequest) =>
        Effect.tryPromise({
          try: () => client.request(input),
          catch: (cause) =>
            new TerminalMacError({
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
      ),
      subscribe: Effect.fn("TerminalMac.subscribe")((id: string) =>
        Effect.sync(() => client.subscribe(id)),
      ),
      unsubscribe: Effect.fn("TerminalMac.unsubscribe")((id: string) =>
        Effect.sync(() => client.unsubscribe(id)),
      ),
      clearSubscriptions: Effect.sync(() => client.clearSubscriptions()),
      listen: Effect.fn("TerminalMac.listen")((listener: (event: TerminalMacEvent) => void) =>
        Effect.acquireRelease(
          Effect.sync(() => client.listen(listener)),
          (remove) => Effect.sync(remove),
        ).pipe(Effect.asVoid),
      ),
    });
  }),
);
