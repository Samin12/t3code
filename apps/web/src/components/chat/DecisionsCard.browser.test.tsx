import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { Decisions } from "@t3tools/shared/toolOutput";

import "~/index.css";
import { render } from "../../../test/render";
import { DecisionsCard } from "./DecisionsCard";
import { useDecisions } from "./useDecisions";

function Harness({
  decisions,
  onSend,
  id = "card",
}: {
  id?: string;
  decisions: Decisions;
  onSend: (message: string) => void;
}) {
  const draft = useDecisions({ id, decisions }, "thread");
  return (
    <DecisionsCard
      decisions={decisions}
      key={id}
      picks={draft.picks}
      onChange={draft.setPicks}
      onSend={() => onSend(draft.message)}
      threadRef={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      }}
    />
  );
}

describe("DecisionsCard", () => {
  it("advances choices, accepts custom answers, lets picks change, and sends one answers block", async () => {
    const onSend = vi.fn();
    await using screen = await render(
      <Harness
        decisions={{
          needs: "you",
          asks: [
            {
              question: "Deploy?",
              options: [{ label: "Ship", does: "I deploy" }, { label: "Wait" }],
              suggested: 0,
            },
            { question: "Where?", options: [{ label: "Staging" }, { label: "Production" }] },
          ],
        }}
        onSend={onSend}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Ship.*Suggested.*I deploy/ }));
    await expect.element(screen.getByText("Where?", { exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Something else" }));
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Answer: Where?" }),
      "Preview environment",
    );
    await userEvent.click(screen.getByRole("button", { name: "Previous question" }));
    await expect
      .element(screen.getByRole("button", { name: /Ship.*Suggested.*I deploy/ }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Wait", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Deploy? → Wait\nWhere? → Preview environment");
    await userEvent.click(screen.getByRole("button", { name: "Decisions needed", exact: true }));
    await expect
      .element(screen.getByRole("button", { name: "Send", exact: true }))
      .not.toBeInTheDocument();
  });

  it("drops earlier picks when a later end_turn replaces the card", async () => {
    const onSend = vi.fn();
    const decisions: Decisions = {
      needs: "you",
      asks: [{ question: "Deploy?", options: [{ label: "Ship" }] }],
    };
    await using screen = await render(<Harness id="first" decisions={decisions} onSend={onSend} />);
    await userEvent.click(screen.getByRole("button", { name: "Ship", exact: true }));
    await expect.element(screen.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await screen.rerender(<Harness id="second" decisions={decisions} onSend={onSend} />);
    await expect.element(screen.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Ship", exact: true }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("toggles carry-on chips without selecting suggestions automatically", async () => {
    const onSend = vi.fn();
    await using screen = await render(
      <Harness
        decisions={{ needs: "nothing", next: ["Add tests", "Write docs"] }}
        onSend={onSend}
      />,
    );
    await expect.element(screen.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add tests", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Write docs", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "✓ Add tests", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Also: Write docs");
  });
});
