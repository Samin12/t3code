import { normalizeDecisions } from "@t3tools/shared/toolOutput";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { DecisionsToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(DecisionsToolkit, {
  end_turn: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      yield* McpInvocationContext.requireThreadScope(scope, "end_turn");
      return {
        decisions: normalizeDecisions(input) ?? { needs: "nothing" as const },
        message:
          "Shown to the user as a card of buttons under your reply; their picks come back as their next message. Write your reply now.",
      };
    }),
  ),
});
