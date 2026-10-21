import * as Schema from "effect/Schema";

const ThreadRef = Schema.Struct({ environmentId: Schema.String, threadId: Schema.String });
export const HeptabaseRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("get"), ref: ThreadRef }),
  Schema.Struct({ action: Schema.Literal("context"), ref: ThreadRef }),
  Schema.Struct({ action: Schema.Literal("create"), ref: ThreadRef, title: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("link"),
    ref: ThreadRef,
    boardId: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literal("unlink"), ref: ThreadRef }),
  Schema.Struct({ action: Schema.Literal("list"), query: Schema.String, offset: Schema.Number }),
  Schema.Struct({ action: Schema.Literal("workspace"), workspaceId: Schema.String }),
]);
export type HeptabaseRequest = typeof HeptabaseRequest.Type;

export const HeptabaseBinding = Schema.Struct({
  boardId: Schema.String,
  title: Schema.String,
  linkedAt: Schema.String,
});
export type HeptabaseBinding = typeof HeptabaseBinding.Type;
export const HeptabaseResponse = Schema.Struct({
  binding: Schema.NullOr(HeptabaseBinding),
  workspaceId: Schema.NullOr(Schema.String),
  context: Schema.optional(Schema.String),
  boards: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  total: Schema.optional(Schema.Number),
});
export type HeptabaseResponse = typeof HeptabaseResponse.Type;
