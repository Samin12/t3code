import { TerminalMacRequest, TerminalMacResponse } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TerminalMac from "../../terminalMac/TerminalMac.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

const mainWindow = Effect.fn("desktop.terminalMac.mainWindow")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  const main = yield* (yield* ElectronWindow.ElectronWindow).main;
  if (!event || Option.isNone(main) || main.value.webContents.id !== event.sender.id) {
    return yield* new TerminalMac.TerminalMacError({
      detail: "Mac requests must come from the T3 window.",
      cause: null,
    });
  }
  return main.value;
});

export const request = DesktopIpc.makeIpcMethod({
  channel: Channels.TERMINAL_MAC_REQUEST_CHANNEL,
  payload: TerminalMacRequest,
  result: TerminalMacResponse,
  handler: Effect.fn("desktop.terminalMac.request")(function* (input, event) {
    yield* mainWindow(event);
    return yield* (yield* TerminalMac.TerminalMac).request(input);
  }),
});

export const subscription = DesktopIpc.makeIpcMethod({
  channel: Channels.TERMINAL_MAC_SUBSCRIPTION_CHANNEL,
  payload: Schema.Struct({ id: Schema.String, active: Schema.Boolean }),
  result: Schema.Void,
  handler: Effect.fn("desktop.terminalMac.subscription")(function* (input, event) {
    yield* mainWindow(event);
    const service = yield* TerminalMac.TerminalMac;
    if (input.active) {
      yield* service.subscribe(input.id);
    } else yield* service.unsubscribe(input.id);
  }),
});

export const installEventForwarding = Effect.fn("desktop.terminalMac.installEventForwarding")(
  function* () {
    const windows = yield* ElectronWindow.ElectronWindow;
    const service = yield* TerminalMac.TerminalMac;
    const run = Effect.runPromiseWith(yield* Effect.context<never>());
    const attached = new Set<Electron.WebContents>();
    const clear = () => {
      void run(service.clearSubscriptions);
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const contents of attached) {
          contents.removeListener("render-process-gone", clear);
          contents.removeListener("did-start-loading", clear);
          contents.removeListener("destroyed", clear);
        }
      }),
    );
    yield* service.listen((event) => {
      void run(
        Effect.gen(function* () {
          const main = yield* windows.main;
          if (Option.isNone(main) || main.value.webContents.isDestroyed()) return;
          const contents = main.value.webContents;
          if (!attached.has(contents)) {
            attached.add(contents);
            contents.on("render-process-gone", clear);
            contents.on("did-start-loading", clear);
            contents.on("destroyed", clear);
          }
          yield* Effect.sync(() => contents.send(Channels.TERMINAL_MAC_EVENT_CHANNEL, event));
        }),
      ).catch(() => undefined);
    });
  },
);
