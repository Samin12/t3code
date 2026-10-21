import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProviderModel,
} from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { truncate } from "@t3tools/shared/String";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { newMessageId, newThreadId } from "../../lib/utils";
import { getProviderModelCapabilities } from "../../providerModels";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { type ProviderHandoffRequest, subscribeProviderHandoff } from "../../providerHandoffBus";
import { useThreadProjection, useThreadShell, useThreadStatus } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { waitForStartedServerThread } from "../ChatView.logic";
import { ProviderHandoffDialog, type ProviderHandoffModelChoice } from "./ProviderHandoffDialog";
import { buildProviderHandoffPrompt } from "./providerHandoff";

function handoffChoiceKey(instanceId: ProviderInstanceId, model: string): string {
  return `${instanceId}:${model}`;
}

function formatOutgoingPrompt(input: {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(input.models, input.model, input.provider);
  return applyClaudePromptEffortPrefix(input.text, resolvePromptInjectedEffort(caps, null));
}

export function ProviderHandoffHost() {
  const [request, setRequest] = useState<ProviderHandoffRequest | null>(null);
  useEffect(() => subscribeProviderHandoff(setRequest), []);
  if (request === null) {
    return null;
  }
  return (
    <ProviderHandoffSession
      key={`${request.threadRef.environmentId}:${request.threadRef.threadId}:${request.instanceId ?? ""}:${request.model ?? ""}`}
      request={request}
      onClose={() => setRequest(null)}
    />
  );
}

function ProviderHandoffSession(props: { request: ProviderHandoffRequest; onClose: () => void }) {
  const { request } = props;
  const shell = useThreadShell(request.threadRef);
  const thread = useThreadProjection(request.threadRef);
  const status = useThreadStatus(request.threadRef);
  const settings = useEnvironmentSettings(request.threadRef.environmentId);
  const providers = useEnvironmentProviders().get(request.threadRef.environmentId);
  const navigate = useNavigate();
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    request.instanceId && request.model
      ? handoffChoiceKey(request.instanceId, request.model)
      : null,
  );

  const source = shell;
  const currentInstanceId =
    source?.runtime?.providerInstanceId ?? source?.providerInstanceId ?? null;
  const currentModel = source?.modelSelection.model ?? null;
  const choices = (() => {
    const entries = sortProviderInstanceEntries(
      deriveProviderInstanceEntries(providers ?? []),
    ).filter(isProviderInstancePickerReady);
    const next: ProviderHandoffModelChoice[] = [];
    for (const entry of entries) {
      const models = entry.models.filter((model) => !model.isLegacy);
      const visible = models.length > 0 ? models : entry.models;
      for (const model of visible) {
        next.push({
          key: handoffChoiceKey(entry.instanceId, model.slug),
          instanceId: entry.instanceId,
          model: model.slug,
          instanceLabel: entry.displayName,
          modelLabel: model.shortName ?? model.name,
          current: entry.instanceId === currentInstanceId && model.slug === currentModel,
        });
      }
    }
    return next;
  })();
  const loading =
    (thread?.projection.messages.length ?? 0) === 0 &&
    (status === "empty" || status === "synchronizing");
  const unavailable = source === null && !loading;

  const onClose = props.onClose;
  const start = async () => {
    const choice = choices.find((candidate) => candidate.key === selectedKey);
    if (!source || !choice || pending) {
      return;
    }
    const entries = deriveProviderInstanceEntries(providers ?? []);
    const target = entries.find((entry) => entry.instanceId === choice.instanceId);
    if (!target) {
      return;
    }
    const sourceLabel =
      entries.find((entry) => entry.instanceId === currentInstanceId)?.displayName ??
      "the current account";
    const handoffPrompt = buildProviderHandoffPrompt({
      sourceLabel,
      targetLabel: target.displayName,
      sourceTitle: source.title,
      messages: (thread?.projection.messages ?? []).map((message) => ({
        role: message.role,
        text: message.text,
      })),
    });
    const outgoingPrompt = formatOutgoingPrompt({
      provider: target.driverKind,
      model: choice.model,
      models: target.models,
      text: handoffPrompt,
    });
    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const nextThreadTitle = truncate(`Handoff from ${sourceLabel}`);
    const runtimeMode = resolveProjectSettings(settings, source.projectId).settings
      .defaultRuntimeMode;
    setPending(true);

    const createResult = await createThread({
      environmentId: request.threadRef.environmentId,
      input: {
        threadId: nextThreadId,
        projectId: source.projectId,
        title: nextThreadTitle,
        modelSelection: { instanceId: choice.instanceId, model: choice.model },
        runtimeMode,
        interactionMode: "default",
        branch: source.branch,
        worktreePath: source.worktreePath,
        createdAt,
      },
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      createResult._tag === "Failure" ? createResult : null;
    if (failure === null) {
      const startResult = await startThreadTurn({
        environmentId: request.threadRef.environmentId,
        input: {
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingPrompt,
            attachments: [],
          },
          modelSelection: { instanceId: choice.instanceId, model: choice.model },
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          createdAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }
    if (failure === null) {
      const startedResult = await settlePromise(() =>
        waitForStartedServerThread(scopeThreadRef(request.threadRef.environmentId, nextThreadId)),
      );
      failure = startedResult._tag === "Failure" ? startedResult : null;
    }
    if (failure === null) {
      const navigateResult = await settlePromise(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: request.threadRef.environmentId,
            threadId: nextThreadId,
          },
        }),
      );
      failure = navigateResult._tag === "Failure" ? navigateResult : null;
    }
    setPending(false);
    if (failure !== null) {
      const cleanupResult = await deleteThread({
        environmentId: request.threadRef.environmentId,
        input: { threadId: nextThreadId },
      });
      if (cleanupResult._tag === "Failure" && !isAtomCommandInterrupted(cleanupResult)) {
        console.warn(
          "Failed to clean up handoff thread after start failure.",
          squashAtomCommandFailure(cleanupResult),
        );
      }
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start handoff thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while creating the new thread.",
          }),
        );
      }
      return;
    }
    onClose();
  };

  return (
    <ProviderHandoffDialog
      open
      sourceTitle={source?.title?.trim() || "this thread"}
      pending={pending}
      loading={loading}
      unavailable={unavailable}
      choices={choices}
      selectedKey={selectedKey}
      onSelect={setSelectedKey}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      onConfirm={() => {
        void start();
      }}
    />
  );
}
