import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const Ask = Schema.Struct({
  question: Schema.String.annotate({ description: "One short question, at most 160 characters." }),
  options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        label: Schema.String.annotate({ description: "An answer in 1 to 4 words." }),
        does: Schema.optional(
          Schema.String.annotate({
            description: "What you will do if picked, at most 90 characters.",
          }),
        ),
      }),
    ).check(Schema.isMaxLength(6)),
  ),
  suggested: Schema.optional(
    Schema.Int.annotate({ description: "Index of the option you would pick." }),
  ),
  links: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.String,
        url: Schema.String.annotate({
          description: "An https:// URL, absolute file path, or ~/ path.",
        }),
      }),
    ).check(Schema.isMaxLength(3)),
  ),
});

const fields = {
  headline: Schema.optional(
    Schema.String.annotate({ description: "One line, at most 80 characters." }),
  ),
  needs: Schema.optional(
    Schema.Literals(["you", "nothing"]).annotate({
      description: "Left out, follows asks. Use nothing when done.",
    }),
  ),
  asks: Schema.optional(Schema.Array(Ask).check(Schema.isMaxLength(10))),
  next: Schema.optional(
    Schema.Array(Schema.String).check(Schema.isMaxLength(3)).annotate({
      description: "Only with needs nothing: worthwhile follow-ups in the user's voice.",
    }),
  ),
};

export const DecisionsToolkit = Toolkit.make(
  Tool.make("end_turn", {
    description:
      "Show decisions as answer buttons under your reply when you need the user. Call this last, then write your reply without repeating the questions. Each ask usually has 2 to 4 options. A later call in the same turn replaces the earlier card. When finished, use needs nothing with next for worthwhile follow-ups, or skip this tool.",
    parameters: Schema.Struct(fields),
    success: Schema.Struct({
      decisions: Schema.Struct({ ...fields, needs: Schema.Literals(["you", "nothing"]) }),
      message: Schema.String,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      McpInvocationContext.McpInvocationContext,
      ThreadManagementService.ThreadManagementService,
    ],
  })
    .annotate(Tool.Title, "Decisions")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
);
