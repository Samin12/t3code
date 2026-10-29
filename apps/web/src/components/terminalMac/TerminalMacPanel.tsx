import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  TerminalMacFrame,
  TerminalMacRequest,
  TerminalMacResponse,
  TerminalMacState,
} from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { registerCommands } from "../../shortcuts/dispatcher";
import { bgraToRgba, decodeAppleLz4 } from "./appleLz4";
import { guestKey, pointerToGuest } from "./terminalMac.logic";

const agentCommand = "claude mcp add terminal-mac -- ~/.local/bin/terminal-mac mcp";
const installCommand =
  "curl -fsSL https://github.com/govijr/terminal-mac/releases/latest/download/get.sh | bash";
const stateLabels: Record<TerminalMacState, string> = {
  "not-installed": "Not installed",
  "not-created": "Not created",
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  "needs-sign-in": "Needs sign-in",
  "needs-permissions": "Needs permissions",
  live: "Live",
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
async function request(input: TerminalMacRequest) {
  const bridge = window.desktopBridge?.terminalMac;
  if (!bridge) throw new Error("Available in the desktop app.");
  return bridge.request(input);
}
async function drawFrame(
  canvas: HTMLCanvasElement,
  frame: TerminalMacFrame,
  current: () => boolean,
) {
  const bitmap =
    frame.format === "png"
      ? await createImageBitmap(new Blob([new Uint8Array(frame.data)], { type: "image/png" }))
      : null;
  if (!current()) {
    bitmap?.close();
    return false;
  }
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (bitmap) {
    context?.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const rgba = bgraToRgba(
      decodeAppleLz4(frame.data, frame.bytesPerRow * frame.height),
      frame.width,
      frame.height,
      frame.bytesPerRow,
    );
    context?.putImageData(
      new ImageData(
        new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
        frame.width,
        frame.height,
      ),
      0,
      0,
    );
  }
  canvas.style.imageRendering =
    Math.min(canvas.clientWidth / frame.width, canvas.clientHeight / frame.height) >= 1
      ? "pixelated"
      : "auto";
  return true;
}

export default function TerminalMacPanel({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<TerminalMacResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [fps, setFps] = useState(0);
  const [setup, setSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef<TerminalMacFrame | null>(null);
  const display = useRef<TerminalMacFrame | null>(null);
  const pointer = useRef<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    button: number;
    count: number;
    moved: boolean;
  } | null>(null);
  const text = useRef("");
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheel = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(visible);

  const send = (input: TerminalMacRequest) => {
    queue.current = queue.current
      .then(() => (active.current ? request(input) : undefined))
      .catch((reason: unknown) => {
        if (active.current) setError(errorMessage(reason));
      });
  };
  const flushText = () => {
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = null;
    if (text.current) {
      send({ action: "type", arguments: { text: text.current } });
      text.current = "";
    }
  };
  const point = (clientX: number, clientY: number, clamp = false) => {
    if (!canvas.current || !display.current) return null;
    return pointerToGuest(
      clientX,
      clientY,
      canvas.current.getBoundingClientRect(),
      display.current,
      clamp,
    );
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribes to the main process frame stream only while this surface is visible.
  useEffect(() => {
    active.current = visible;
    if (!visible) return;
    let cancelled = false;
    let animation: number | null = null;
    let drawing = false;
    let frames = 0;
    let measuredAt = performance.now();
    const schedule = () => {
      if (cancelled || drawing || animation !== null) return;
      animation = requestAnimationFrame(() => {
        animation = null;
        const frame = latest.current;
        const element = canvas.current;
        if (!frame || !element) return;
        drawing = true;
        void drawFrame(element, frame, () => !cancelled && latest.current === frame)
          .then((drawn) => {
            if (cancelled) return;
            if (drawn) {
              display.current = frame;
              setHasFrame(true);
            }
          })
          .catch((reason: unknown) => {
            if (!cancelled) setError(errorMessage(reason));
          })
          .then(() => {
            drawing = false;
            if (latest.current !== frame) schedule();
          });
      });
    };
    void request({ action: "status" })
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    const unsubscribe = window.desktopBridge?.terminalMac?.subscribe((event) => {
      if (cancelled) return;
      if (event.type === "error") {
        setError(event.message);
        return;
      }
      if (event.type === "state") {
        setStatus(event.status);
        if (event.status.state === "live") setError(null);
        else if (
          ["stopped", "not-created", "not-installed", "starting", "needs-sign-in"].includes(
            event.status.state,
          )
        ) {
          display.current = null;
          setHasFrame(false);
        }
        return;
      }
      latest.current = event.frame;
      frames += 1;
      const now = performance.now();
      if (now - measuredAt >= 1000) {
        setFps(Math.round((frames * 1000) / (now - measuredAt)));
        frames = 0;
        measuredAt = now;
      }
      schedule();
    });
    const idleFps = setInterval(() => {
      if (performance.now() - measuredAt >= 1500) setFps(0);
    }, 1500);
    return () => {
      active.current = false;
      cancelled = true;
      unsubscribe?.();
      clearInterval(idleFps);
      if (animation !== null) cancelAnimationFrame(animation);
      if (textTimer.current) clearTimeout(textTimer.current);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      text.current = "";
      wheel.current = null;
      pointer.current = null;
      latest.current = null;
      display.current = null;
    };
  }, [visible]);

  const handleWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const location = point(event.clientX, event.clientY);
    if (!location) return;
    const scale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? display.current!.pointHeight : 1;
    const previous = wheel.current;
    wheel.current = {
      ...location,
      dx: (previous?.dx ?? 0) - event.deltaX * scale,
      dy: (previous?.dy ?? 0) - event.deltaY * scale,
    };
    if (wheelTimer.current) return;
    wheelTimer.current = setTimeout(() => {
      wheelTimer.current = null;
      const pending = wheel.current;
      wheel.current = null;
      if (!pending) return;
      flushText();
      send({
        action: "scroll",
        arguments: {
          x: String(pending.x),
          y: String(pending.y),
          dx: String(Math.max(-1000, Math.min(1000, Math.round(pending.dx)))),
          dy: String(Math.max(-1000, Math.min(1000, Math.round(pending.dy)))),
        },
      });
    }, 30);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A native wheel listener must be non-passive to keep guest scrolling inside the canvas.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !visible) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [visible]);

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.isComposing) return;
    const input = guestKey(event);
    if (!input) return;
    if (input.action === "type") {
      text.current += input.text;
      if (!textTimer.current) textTimer.current = setTimeout(flushText, 25);
    } else {
      flushText();
      send({ action: "key", arguments: { key: input.key } });
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Claims focused guest keys before T3's capture-phase shortcut handlers.
  useEffect(() => {
    if (!visible) return;
    return registerCommands(
      {},
      {
        capture: true,
        when: (event) => event.target === canvas.current,
        onKeyDown: handleKey,
      },
    );
  }, [visible]);

  const perform = async (action: TerminalMacRequest["action"]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (action === "start" || action === "open-window")
      setStatus((previous) => (previous ? { ...previous, state: "starting" } : previous));
    await request({ action })
      .then(setStatus)
      .catch((reason: unknown) => setError(errorMessage(reason)));
    setBusy(false);
  };
  const running =
    status && ["running", "live", "needs-sign-in", "needs-permissions"].includes(status.state);
  const needsSetup =
    status && (!status.installed || !status.machineExists || status.state === "not-installed");
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <span className="rounded-full bg-muted px-2 py-1" role="status">
          {status ? stateLabels[status.state] : "Checking…"}
          {status?.state === "live" ? ` · ${fps} fps` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status?.installed || status.state === "not-installed" || !!running}
          onClick={() => void perform("start")}
        >
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status?.installed || status.state === "not-installed"}
          onClick={() => void perform("open-window")}
        >
          Open window
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !running}
          onClick={() => void perform("stop")}
        >
          Stop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(agentCommand)
              .then(() => setCopied(true))
              .catch((reason: unknown) => setError(errorMessage(reason)));
          }}
        >
          {copied ? "Copied" : "Copy for agents"}
        </Button>
      </div>
      {error && (
        <div className="border-b p-3 text-destructive" role="alert">
          {error}
        </div>
      )}
      {status?.message && status.state !== "not-installed" && (
        <p className="p-3 text-muted-foreground">{status.message}</p>
      )}
      {needsSetup && (
        <div className="space-y-3 p-4">
          <p>Run a separate virtual Mac here. Its desktop is shared with your agents.</p>
          <p className="text-muted-foreground">
            machine.json: {status.machineExists ? "Found" : "Not found"}
            {status.machineExists && !status.installed ? " · Installation in progress" : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setSetup(true);
              if (status.machineExists && status.state !== "not-installed")
                void perform("open-window");
            }}
          >
            Set up virtual Mac
          </Button>
          {setup && (
            <div className="space-y-2 text-muted-foreground">
              {status.state === "not-installed" && (
                <>
                  <p>Install terminal-mac in Terminal:</p>
                  <code className="block select-text break-all">{installCommand}</code>
                </>
              )}
              <p>
                {status.machineExists
                  ? "Let the current installation finish, then open the window to complete macOS setup."
                  : "Run this in Terminal to download and set up macOS. If setup is already running, let it finish."}
              </p>
              {!status.machineExists && (
                <code className="block select-text">~/.local/bin/terminal-mac setup</code>
              )}
            </div>
          )}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="Virtual Mac desktop"
          className={`h-full w-full touch-none object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${hasFrame ? "" : "invisible"}`}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            flushText();
            pointer.current = null;
          }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0 && event.button !== 2) return;
            const location = point(event.clientX, event.clientY);
            if (!location) return;
            event.stopPropagation();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = {
              ...location,
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button,
              count: Math.max(1, Math.min(3, event.detail)),
              moved: false,
            };
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (pointer.current) pointer.current.count = Math.max(1, Math.min(3, event.detail));
          }}
          onPointerMove={(event) => {
            const start = pointer.current;
            if (
              start &&
              Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 4
            )
              start.moved = true;
          }}
          onPointerCancel={() => {
            pointer.current = null;
          }}
          onPointerUp={(event) => {
            const start = pointer.current;
            pointer.current = null;
            if (!start) return;
            event.preventDefault();
            event.stopPropagation();
            const end = point(event.clientX, event.clientY, true);
            if (!end) return;
            flushText();
            const moved =
              start.moved ||
              Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 4;
            if (moved && start.button === 0)
              send({
                action: "drag",
                arguments: {
                  x: String(start.x),
                  y: String(start.y),
                  x2: String(end.x),
                  y2: String(end.y),
                },
              });
            else if (!moved)
              send({
                action: "click",
                arguments: {
                  x: String(end.x),
                  y: String(end.y),
                  ...(start.button === 2 ? { button: "right" } : {}),
                  ...(start.count > 1 ? { count: String(start.count) } : {}),
                },
              });
          }}
          onKeyUp={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onCompositionEnd={(event) => {
            if (event.data) {
              text.current += event.data;
              flushText();
            }
          }}
        />
        {hasFrame && !focused && (
          <span className="pointer-events-none absolute bottom-4 rounded bg-black/70 px-3 py-2 text-white">
            Click to control
          </span>
        )}
        {!hasFrame && !needsSetup && (
          <p className="pointer-events-none absolute px-4 text-center text-white/70">
            {status?.state === "needs-sign-in"
              ? "Open the window, sign in, and open TerminalMacGuest."
              : status?.state === "stopped"
                ? "Start the virtual Mac to see its desktop."
                : "Waiting for the virtual Mac…"}
          </p>
        )}
      </div>
    </div>
  );
}
