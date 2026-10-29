import type { HeptabaseRequest, HeptabaseResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { HeptabaseClient, makeHeptabaseCli } from "./HeptabaseClient.ts";

export class HeptabaseError extends Schema.TaggedError<HeptabaseError>()("HeptabaseError", {
  detail: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.detail;
  }
}
export class Heptabase extends Context.Service<
  Heptabase,
  {
    readonly request: (input: HeptabaseRequest) => Effect.Effect<HeptabaseResponse, HeptabaseError>;
  }
>()("@t3tools/desktop/heptabase/Heptabase") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const client = new HeptabaseClient(
    environment.path.join(environment.stateDir, "heptabase"),
    makeHeptabaseCli("heptabase"),
  );
  return Heptabase.of({
    request: Effect.fn("Heptabase.request")((input: HeptabaseRequest) =>
      Effect.tryPromise({
        try: () => client.request(input),
        catch: (cause) =>
          new HeptabaseError({
            detail:
              cause instanceof Error
                ? cause.message
                : "Unable to access Heptabase. Open its desktop app and enable the Local CLI Server.",
            cause,
          }),
      }),
    ),
  });
});
export const layer = Layer.effect(Heptabase, make);
