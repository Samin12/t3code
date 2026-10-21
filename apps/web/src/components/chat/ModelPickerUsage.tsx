import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDaysIcon, Clock3Icon } from "lucide-react";
import { useState } from "react";
import type { ModelPickerUsageState } from "./ModelPickerUsage.logic";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import { cn } from "~/lib/utils";

export function ModelPickerUsage({ usage }: { usage: ModelPickerUsageState }) {
  if (usage.notice)
    return <div className="mt-1 text-2xs text-muted-foreground">{usage.notice}</div>;
  return (
    <div className="mt-1.5 flex flex-col gap-1" data-model-picker-usage>
      {usage.windows.map((window) => {
        const Icon = window.kind === "weekly" ? CalendarDaysIcon : Clock3Icon;
        return (
          <Tooltip key={window.id}>
            <TooltipTrigger
              render={<div />}
              className={cn(
                "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs leading-snug tabular-nums",
                window.exhausted
                  ? window.kind === "weekly"
                    ? "text-error"
                    : "text-warning"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="font-medium">{window.label}</span>
              <span>
                {window.awaitingRefresh
                  ? "Awaiting update"
                  : window.exhausted
                    ? "Limit reached"
                    : `${window.remaining === 0 ? "<1" : window.remaining}% left`}
              </span>
              <span className="text-muted-foreground">· {window.reset}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {window.resetAt === null
                ? window.reset
                : `Resets ${new Date(window.resetAt).toLocaleString()}`}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function ModelPickerUsageActions(props: {
  environmentId: EnvironmentId | null;
  onRefreshed: () => void;
  onRequestClose: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLimits = async () => {
    const environmentId = props.environmentId;
    if (!environmentId) return;
    setRefreshing(true);
    // Settled so the countdowns still advance when a refresh fails.
    await settlePromise(() =>
      refreshUsageLimits(environmentId, () =>
        refreshProviders({ environmentId, input: { fresh: true } }),
      ),
    );
    props.onRefreshed();
    setRefreshing(false);
  };
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 px-3 py-2 text-xs">
      <InlineButton
        disabled={refreshing || !props.environmentId}
        onClick={() => void refreshLimits()}
      >
        {refreshing ? "Refreshing…" : "Refresh limits"}
      </InlineButton>
      <InlineButton
        onClick={() => {
          saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
          props.onRequestClose?.();
          void navigate({ to: "/usage" });
        }}
      >
        Manage usage
      </InlineButton>
    </div>
  );
}
