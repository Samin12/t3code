const referenceEpoch = 978307200000;

export function encodeRequest(
  id: string,
  action: string,
  args: Record<string, string>,
  deadlineMs: number,
) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    throw new Error("Invalid request UUID.");
  return {
    id: id.toUpperCase(),
    action,
    arguments: args,
    deadline: (deadlineMs - referenceEpoch) / 1000,
  };
}
