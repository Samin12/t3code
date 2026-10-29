import { HeptabaseRequest, HeptabaseResponse } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Heptabase from "../../heptabase/Heptabase.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const request = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.HEPTABASE_REQUEST_CHANNEL,
  payload: HeptabaseRequest,
  result: HeptabaseResponse,
  handler: Effect.fn("desktop.heptabase.request")(function* (input, event) {
    const main = yield* (yield* ElectronWindow.ElectronWindow).main;
    if (!event || Option.isNone(main) || main.value.webContents.id !== event.sender.id) {
      return yield* new Heptabase.HeptabaseError({
        detail: "Heptabase requests must come from the T3 window.",
        cause: null,
      });
    }
    return yield* (yield* Heptabase.Heptabase).request(input);
  }),
});
