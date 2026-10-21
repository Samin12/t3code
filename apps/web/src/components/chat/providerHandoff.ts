/**
 * A provider switch that cannot resume the current session. The original
 * thread stays on its account. A new thread receives this brief.
 */
export const PROVIDER_HANDOFF_DISCLAIMER =
  "This chat stays on the current account. A new thread starts on the account you picked, with a summary of this conversation. That account does not receive the old session, so it can miss details and should re-read the repo before trusting the summary.";

const MAX_HANDOFF_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 1_200;
const MAX_HANDOFF_CHARS = 14_000;

const SECRET_PATTERN =
  /(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

export function providerSwitchNeedsHandoff(input: {
  locked: boolean;
  currentDriver: string | null;
  nextDriver: string | null;
  currentContinuationGroupKey: string | null;
  nextContinuationGroupKey: string | null;
}): boolean {
  if (!input.locked) return false;
  if (
    input.currentDriver !== null &&
    input.nextDriver !== null &&
    input.currentDriver !== input.nextDriver
  ) {
    return true;
  }
  return (
    input.currentContinuationGroupKey !== null &&
    input.nextContinuationGroupKey !== null &&
    input.currentContinuationGroupKey !== input.nextContinuationGroupKey
  );
}

export function redactHandoffSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]");
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

export function buildProviderHandoffPrompt(input: {
  sourceLabel: string;
  targetLabel: string;
  sourceTitle?: string | null;
  messages: ReadonlyArray<{ role: string; text: string }>;
}): string {
  const excerpts = input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      text: clip(redactHandoffSecrets(message.text), MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.text.length > 0 && message.text !== "/compact")
    .slice(-MAX_HANDOFF_MESSAGES);

  const transcript =
    excerpts.length === 0
      ? "No earlier user or assistant messages were stored on this thread."
      : excerpts
          .map(
            (message) => `### ${message.role === "user" ? "User" : "Assistant"}\n${message.text}`,
          )
          .join("\n\n");

  const title = input.sourceTitle?.trim();
  const prompt = [
    "# Handoff",
    "",
    PROVIDER_HANDOFF_DISCLAIMER,
    "",
    `Continue this work on **${input.targetLabel}**. The previous thread stays on **${input.sourceLabel}**.`,
    ...(title ? [`Previous thread: ${title}.`] : []),
    "",
    "The notes below are a summary of the stored conversation, not the old session. Re-read the files you touch. Treat unchecked claims, including statements that something is done, as unverified.",
    "",
    "## Recent conversation",
    "",
    transcript,
    "",
    "## What to do",
    "",
    "Continue from the latest user request. Do not repeat work the repo already contains.",
  ].join("\n");

  return clip(prompt, MAX_HANDOFF_CHARS);
}
