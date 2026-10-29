import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Exit from "effect/Exit";

vi.mock("electron", () => ({}));

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as TerminalMac from "../../terminalMac/TerminalMac.ts";
import { request, subscription } from "./terminalMac.ts";

const status = { state: "stopped", machineExists: true, installed: true } as const;
function setup(mainId: number | null) {
  const handleRequest = vi.fn(() => Effect.succeed(status));
  const subscribe = vi.fn(() => Effect.void);
  const unsubscribe = vi.fn(() => Effect.void);
  const layer = Layer.mergeAll(
    Layer.mock(TerminalMac.TerminalMac, { request: handleRequest, subscribe, unsubscribe }),
    Layer.mock(ElectronWindow.ElectronWindow, {
      main: Effect.succeed(
        mainId === null
          ? Option.none()
          : Option.some({ webContents: { id: mainId } } as Electron.BrowserWindow),
      ),
    }),
  );
  return { layer, handleRequest, subscribe, unsubscribe };
}

describe("Mac IPC authorization", () => {
  it.effect.each([null, 7])("rejects another window and absent sender when main is %s", (mainId) =>
    Effect.gen(function* () {
      const state = setup(mainId);
      for (const sender of [undefined, { sender: { id: 8 } }]) {
        expect(
          Exit.isFailure(
            yield* request
              .handler({ action: "start" }, sender)
              .pipe(Effect.provide(state.layer), Effect.exit),
          ),
        ).toBe(true);
        expect(
          Exit.isFailure(
            yield* subscription
              .handler({ id: "viewer", active: true }, sender)
              .pipe(Effect.provide(state.layer), Effect.exit),
          ),
        ).toBe(true);
        expect(
          Exit.isFailure(
            yield* subscription
              .handler({ id: "viewer", active: false }, sender)
              .pipe(Effect.provide(state.layer), Effect.exit),
          ),
        ).toBe(true);
      }
      expect(state.handleRequest).not.toHaveBeenCalled();
      expect(state.subscribe).not.toHaveBeenCalled();
      expect(state.unsubscribe).not.toHaveBeenCalled();
    }),
  );
  it.effect("accepts machine-wide requests and balanced subscriptions from the main window", () =>
    Effect.gen(function* () {
      const state = setup(7);
      const sender = { sender: { id: 7 } };
      expect(
        yield* request.handler({ action: "status" }, sender).pipe(Effect.provide(state.layer)),
      ).toEqual(status);
      yield* subscription
        .handler({ id: "viewer", active: true }, sender)
        .pipe(Effect.provide(state.layer));
      yield* subscription
        .handler({ id: "viewer", active: false }, sender)
        .pipe(Effect.provide(state.layer));
      expect(state.subscribe).toHaveBeenCalledWith("viewer");
      expect(state.unsubscribe).toHaveBeenCalledWith("viewer");
    }),
  );
});
