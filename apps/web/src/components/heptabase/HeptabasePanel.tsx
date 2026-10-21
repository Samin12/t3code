import { useEffect, useRef, useState } from "react";
import type { HeptabaseRequest, HeptabaseResponse, ScopedThreadRef } from "@t3tools/contracts";
import { Link2Icon, MoreHorizontalIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const HOME = "https://app.heptabase.com/";
const workspacePattern =
  /^\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i;
const browserUserAgent = navigator.userAgent
  .replace(/\s\S*Electron\/\S+/g, "")
  .replace(/\sT3\S+\/\S+/g, "");
const request = (input: HeptabaseRequest) => {
  const bridge = window.desktopBridge?.heptabase;
  if (!bridge)
    return Promise.reject(new Error("Restart the updated desktop app to enable Heptabase."));
  return bridge.request(input);
};

// Reports failure instead of throwing: the React Compiler cannot lower try/finally,
// so the component keeps its own control flow free of it.
async function settleRequest(
  input: HeptabaseRequest,
): Promise<
  | { readonly ok: true; readonly value: HeptabaseResponse }
  | { readonly ok: false; readonly error: string }
> {
  try {
    return { ok: true, value: await request(input) };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
  }
}

function boardUrl(state: HeptabaseResponse) {
  return state.workspaceId && state.binding
    ? `${HOME}${state.workspaceId}/whiteboard/${state.binding.boardId}`
    : HOME;
}

export default function HeptabasePanel({
  threadRef,
  title,
  visible,
}: {
  threadRef: ScopedThreadRef;
  title: string;
  visible: boolean;
}) {
  const [state, setState] = useState<HeptabaseResponse | null>(null);
  const [name, setName] = useState(title || "New whiteboard");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HeptabaseResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [src, setSrc] = useState(HOME);
  const [showApp, setShowApp] = useState(false);
  const [loading, setLoading] = useState(false);
  const webview = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mounted.current = true;
    void request({ action: "get", ref: threadRef })
      .then((value) => {
        if (!mounted.current) return;
        setState(value);
        setSrc(boardUrl(value));
        setShowApp(Boolean(value.binding));
      })
      .catch((reason: unknown) => {
        if (mounted.current) setError(String(reason));
      });
    return () => {
      mounted.current = false;
    };
  }, [threadRef]);

  const perform = async (input: HeptabaseRequest) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const result = await settleRequest(input);
    pending.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const value = result.value;
    if (input.action === "list") setResults(value);
    else {
      setState(value);
      if (input.action === "create" || input.action === "link") {
        setSrc(boardUrl(value));
        setShowApp(true);
        setShowContext(false);
      }
      if (input.action === "unlink") {
        setShowApp(false);
        setShowContext(false);
      }
    }
  };

  const attachWebview = (element: HTMLElement | null) => {
    webview.current = element;
  };
  useEffect(() => {
    const element = webview.current;
    if (!element || !showApp) return;
    const navigated = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (!url) return;
      const location = new URL(url);
      if (location.origin !== new URL(HOME).origin) return;
      const workspaceId = workspacePattern.exec(location.pathname)?.[1];
      if (!workspaceId || workspaceId === stateRef.current?.workspaceId) return;
      void request({ action: "workspace", workspaceId })
        .then(() => {
          if (!mounted.current) return;
          const updated = { binding: stateRef.current?.binding ?? null, workspaceId };
          setState(updated);
          if (updated.binding) setSrc(boardUrl(updated));
        })
        .catch((reason: unknown) => {
          if (mounted.current) setError(String(reason));
        });
    };
    const ready = () => setLoading(false);
    const start = () => setLoading(true);
    const failed = (event: Event) => {
      const failure = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (failure.isMainFrame && failure.errorCode !== -3) {
        setError(`Could not display Heptabase: ${failure.errorDescription ?? "connection failed"}`);
        setLoading(false);
      }
    };
    element.addEventListener("did-navigate", navigated);
    element.addEventListener("did-navigate-in-page", navigated);
    element.addEventListener("did-start-loading", start);
    element.addEventListener("did-stop-loading", ready);
    element.addEventListener("did-fail-load", failed);
    return () => {
      element.removeEventListener("did-navigate", navigated);
      element.removeEventListener("did-navigate-in-page", navigated);
      element.removeEventListener("did-start-loading", start);
      element.removeEventListener("did-stop-loading", ready);
      element.removeEventListener("did-fail-load", failed);
    };
  }, [showApp]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Heptabase surface">
      {error ? (
        <div role="alert" className="border-b p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {state?.binding ? (
        <div className="flex h-7 shrink-0 items-center gap-1 border-b px-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground" />
              }
            >
              <Link2Icon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{state.binding.title || "Untitled whiteboard"}</span>
            </TooltipTrigger>
            <TooltipPopup>
              Linked to this session · board context included with messages
            </TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" size="icon-micro" aria-label="Heptabase board options" />
              }
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                disabled={busy}
                onClick={() => {
                  setShowContext(!showContext);
                  if (!showContext) void perform({ action: "context", ref: threadRef });
                }}
              >
                {showContext ? "Hide board context" : "Show board context"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setSrc(boardUrl(state));
                  setShowContext(false);
                }}
              >
                Go to linked board
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={busy}
                onClick={() => void perform({ action: "unlink", ref: threadRef })}
              >
                Unlink board
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-b p-4">
          <div>
            <h3 className="font-medium">A whiteboard for this session</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a board or link an existing one. Keep the Heptabase desktop app open for CLI
              access.
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void perform({ action: "create", ref: threadRef, title: name });
            }}
          >
            <Input
              aria-label="Whiteboard name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={busy || !state || !name.trim()}>
              New Whiteboard
            </Button>
          </form>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              void perform({ action: "list", query, offset: 0 });
            }}
          >
            <Input
              aria-label="Find existing whiteboards"
              placeholder="Find an existing whiteboard"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button variant="outline" type="submit" disabled={busy}>
              Search
            </Button>
          </form>
          {results?.boards ? (
            <div className="max-h-64 overflow-y-auto">
              {results.boards.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">No whiteboards found.</p>
              ) : (
                results.boards.map((board) => (
                  <button
                    key={board.id}
                    className="flex w-full items-center justify-between gap-2 rounded p-2 text-left text-sm hover:bg-accent"
                    disabled={busy}
                    onClick={() =>
                      void perform({
                        action: "link",
                        ref: threadRef,
                        boardId: board.id,
                        title: board.name,
                      })
                    }
                  >
                    <span>{board.name || "Untitled whiteboard"}</span>
                    <span className="text-muted-foreground">Link</span>
                  </button>
                ))
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || offset === 0}
                  onClick={() => {
                    const next = Math.max(0, offset - 30);
                    setOffset(next);
                    void perform({ action: "list", query, offset: next });
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || offset + 30 >= (results.total ?? 0)}
                  onClick={() => {
                    const next = offset + 30;
                    setOffset(next);
                    void perform({ action: "list", query, offset: next });
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setShowApp(!showApp)}>
            {showApp ? "Hide app" : "Open Heptabase app"}
          </Button>
        </div>
      )}
      {busy ? (
        <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
          Connecting to Heptabase…
        </p>
      ) : null}
      {showContext ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Read live through the desktop CLI. Unlink to stop including this board in messages.
          </p>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {state?.context ?? "Reading board…"}
          </pre>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void perform({ action: "context", ref: threadRef })}
          >
            Refresh context
          </Button>
        </div>
      ) : null}
      {showApp ? (
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: visible && !showContext ? undefined : "none" }}
        >
          {!state?.workspaceId ? (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              Sign in to Heptabase once here. Use the same workspace as the desktop app.
            </p>
          ) : null}
          {loading ? (
            <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
              Loading Heptabase…
            </p>
          ) : null}
          <webview
            ref={attachWebview}
            src={src}
            partition="persist:t3code-heptabase"
            useragent={browserUserAgent}
            webpreferences="contextIsolation=true,sandbox=true,nodeIntegration=false"
            className="flex min-h-0 w-full flex-1"
          />
        </div>
      ) : null}
    </div>
  );
}
