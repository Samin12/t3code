import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentModelPreferences: (() => ({ favorites: [] })) as never,
  useToggleEnvironmentModelFavorite: (() => vi.fn()) as never,
}));

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ModelPickerContent } from "./ModelPickerContent";

const MODEL = "claude-opus-4-8";
const HOUR = 60 * 60 * 1000;

function claudeAccount(id: string, name: string, sessionUsedPercent: number): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: name,
    continuation: { groupKey: `claude:home:/Users/me/.${id}` },
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [{ slug: MODEL, name: "Claude Opus 4.8", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt: new Date().toISOString(),
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: sessionUsedPercent,
          resetsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
          windowDurationMins: 300,
        },
        {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 20,
          resetsAt: new Date(Date.now() + 72 * HOUR).toISOString(),
        },
      ],
    },
  };
}

const current = ProviderInstanceId.make("claude_100");
const spent = ProviderInstanceId.make("claude_200");
const entries = deriveProviderInstanceEntries([
  claudeAccount("claude_100", "Voyager · Claude 100", 40),
  claudeAccount("claude_200", "Voyager · Claude 200", 100),
]);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// A thread that started on Claude 100: its session cannot resume on another account.
async function openLockedPicker() {
  const onInstanceModelChange = vi.fn();
  const onRequestClose = vi.fn();
  const picker = () => (
    <ModelPickerContent
      environmentId={null}
      activeInstanceId={current}
      model={MODEL}
      lockedProvider={ProviderDriverKind.make("claudeAgent")}
      lockedContinuationGroupKey="claude:home:/Users/me/.claude_100"
      instanceEntries={entries}
      modelOptionsByInstance={new Map(entries.map((entry) => [entry.instanceId, entry.models]))}
      terminalOpen={false}
      searchInputRef={{ current: null }}
      getModelDisabledReason={(instanceId) =>
        instanceId === current ? null : "This thread cannot resume on another account."
      }
      onRequestClose={onRequestClose}
      onInstanceModelChange={onInstanceModelChange}
    />
  );
  const router = createRouter({
    routeTree: createRootRoute({ component: picker }),
    history: createMemoryHistory(),
  });
  await router.load();
  await act(async () => root.render(<RouterProvider router={router} />));
  await vi.waitFor(() =>
    expect(container.querySelector("[data-model-picker-content]")).not.toBeNull(),
  );
  return { onInstanceModelChange, onRequestClose };
}

function providerButton(instanceId: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-model-picker-provider="${instanceId}"] button`,
  );
  if (!button) throw new Error(`No sidebar button for ${instanceId}`);
  return button;
}

describe("ModelPickerContent in a locked thread", () => {
  it("hands off to a spent account's model while showing its usage", async () => {
    const { onInstanceModelChange, onRequestClose } = await openLockedPicker();
    expect(container.textContent).toContain("60% left");

    const otherAccount = providerButton(spent);
    expect(otherAccount.getAttribute("aria-label")).toContain("starts a new thread");
    expect(otherAccount.getAttribute("aria-label")).toContain("5-hour: limit reached");
    expect(otherAccount.disabled).toBe(false);

    await userEvent.click(otherAccount);
    await vi.waitFor(() => expect(container.textContent).toContain("Limit reached"));

    // The list now holds only the selected account's models.
    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("aria-disabled")).not.toBe("true");
    await userEvent.click(rows[0]!);

    expect(onRequestClose).toHaveBeenCalled();
    expect(onInstanceModelChange).toHaveBeenCalledWith(spent, MODEL);
  });

  it("shows every account's usage on mixed search results", async () => {
    await openLockedPicker();
    const search = container.querySelector<HTMLInputElement>("input");
    expect(search).not.toBeNull();
    await userEvent.type(search!, "opus");

    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-model-picker-usage]")).toHaveLength(2),
    );
    expect(container.textContent).toContain("Limit reached");
    expect(container.textContent).toContain("60% left");
  });
});
