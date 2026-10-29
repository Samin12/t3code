import type { ProviderInstanceId } from "@t3tools/contracts";

import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { PROVIDER_HANDOFF_DISCLAIMER } from "./providerHandoff";

export interface ProviderHandoffModelChoice {
  readonly key: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly instanceLabel: string;
  readonly modelLabel: string;
  readonly current: boolean;
}

export function ProviderHandoffDialog(props: {
  open: boolean;
  sourceTitle: string;
  pending: boolean;
  loading: boolean;
  unavailable: boolean;
  choices: readonly ProviderHandoffModelChoice[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const groups: Array<{ label: string; choices: ProviderHandoffModelChoice[] }> = [];
  for (const choice of props.choices) {
    const group = groups.find((candidate) => candidate.label === choice.instanceLabel);
    if (group) {
      group.choices.push(choice);
    } else {
      groups.push({ label: choice.instanceLabel, choices: [choice] });
    }
  }
  const selected = props.choices.find((choice) => choice.key === props.selectedKey) ?? null;

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Hand off {props.sourceTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            {PROVIDER_HANDOFF_DISCLAIMER} Pick the model for the new thread. This thread stays where
            it is.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-72 overflow-y-auto px-6 pb-2">
          {props.unavailable ? (
            <p className="text-sm text-muted-foreground">This thread is not available.</p>
          ) : props.loading ? (
            <p className="text-sm text-muted-foreground">Loading this conversation…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ready model is available.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="px-2 pb-1 text-xs text-muted-foreground">{group.label}</div>
                  <div className="flex flex-col">
                    {group.choices.map((choice) => {
                      const isSelected = choice.key === props.selectedKey;
                      return (
                        <button
                          key={choice.key}
                          type="button"
                          disabled={props.pending}
                          aria-pressed={isSelected}
                          className={
                            isSelected
                              ? "rounded-md bg-foreground/10 px-2 py-1.5 text-left text-sm"
                              : "rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
                          }
                          onClick={() => props.onSelect(choice.key)}
                        >
                          {choice.modelLabel}
                          {choice.current ? (
                            <span className="text-muted-foreground"> · current</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={props.pending} />}>
            Cancel
          </AlertDialogClose>
          <Button
            disabled={props.pending || props.loading || props.unavailable || selected === null}
            onClick={props.onConfirm}
          >
            {props.pending ? "Starting…" : "Start new thread"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
