export interface DecisionOption {
  readonly label: string;
  readonly does?: string;
}

export interface DecisionAsk {
  readonly question: string;
  readonly options?: ReadonlyArray<DecisionOption>;
  readonly suggested?: number;
  readonly links?: ReadonlyArray<{ readonly title: string; readonly url: string }>;
}

export interface Decisions {
  readonly headline?: string;
  readonly needs: "you" | "nothing";
  readonly asks?: ReadonlyArray<DecisionAsk>;
  readonly next?: ReadonlyArray<string>;
}

export interface DecisionPicks {
  readonly answers: Readonly<Record<number, string>>;
  readonly next: ReadonlyArray<number>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = Array.from(value.replace(/\s+/g, " ").trim()).slice(0, limit).join("");
  return result || undefined;
}

function linkUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!url || url.length > 2000 || /[\u0000-\u001f\u007f]/.test(url)) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("~/")) return url;
  try {
    return /^https:\/\//i.test(url) && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeDecisions(input: unknown): Decisions | undefined {
  const value = record(input);
  if (!value || (value.needs !== undefined && value.needs !== "you" && value.needs !== "nothing")) {
    return undefined;
  }
  const headline = text(value.headline, 80);
  const asks: DecisionAsk[] = [];
  for (const entry of Array.isArray(value.asks) ? value.asks : []) {
    const ask = record(entry);
    const question = text(ask?.question, 160);
    if (!ask || !question) continue;
    const options = (Array.isArray(ask.options) ? ask.options : [])
      .flatMap((entry) => {
        const option = record(entry);
        // Clipped by length only: dropping words can change what an answer means.
        const label = text(option?.label, 60);
        const does = text(option?.does, 90);
        return label ? [{ label, ...(does ? { does } : {}) }] : [];
      })
      .slice(0, 6);
    const links = (Array.isArray(ask.links) ? ask.links : [])
      .flatMap((entry) => {
        const link = record(entry);
        const title = text(link?.title, 80);
        const url = linkUrl(link?.url);
        return title && url ? [{ title, url }] : [];
      })
      .slice(0, 3);
    const suggested = ask.suggested;
    asks.push({
      question,
      ...(options.length ? { options } : {}),
      ...(typeof suggested === "number" &&
      Number.isInteger(suggested) &&
      suggested >= 0 &&
      suggested < options.length
        ? { suggested }
        : {}),
      ...(links.length ? { links } : {}),
    });
    if (asks.length === 10) break;
  }
  const needs = value.needs ?? (asks.length ? "you" : "nothing");
  const next =
    needs === "nothing"
      ? [
          ...new Set(
            (Array.isArray(value.next) ? value.next : []).flatMap(
              (entry) => text(entry, 120) ?? [],
            ),
          ),
        ].slice(0, 3)
      : [];
  return {
    ...(headline ? { headline } : {}),
    needs,
    ...(needs === "you" && asks.length ? { asks } : {}),
    ...(next.length ? { next } : {}),
  };
}

export function decisionsMessage(decisions: Decisions, picks: DecisionPicks): string {
  if (decisions.needs === "nothing") {
    return (decisions.next ?? [])
      .flatMap((item, index) => (picks.next.includes(index) ? [`Also: ${item}`] : []))
      .join("\n");
  }
  return (decisions.asks ?? [])
    .flatMap((ask, index) => {
      const answer = picks.answers[index]?.replace(/\s+/g, " ").trim();
      return answer ? [`${ask.question} → ${answer}`] : [];
    })
    .join("\n");
}
