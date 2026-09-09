import type { AgentTurn, AgentTurnEvent, TurnUsage } from "../types";

export function isMeaningfulResponse(
  event: AgentTurnEvent
): event is Extract<AgentTurnEvent, { kind: "response" }> {
  return event.kind === "response" && event.text.trim().length > 0;
}

export function splitFinalResponse(turn: AgentTurn): {
  traceEvents: AgentTurnEvent[];
  finalResponse?: Extract<AgentTurnEvent, { kind: "response" }>;
} {
  const events = turn.events.filter(
    event => event.kind !== "response" || isMeaningfulResponse(event)
  );
  let finalIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isMeaningfulResponse(events[index])) {
      finalIndex = index;
      break;
    }
  }
  if (finalIndex < 0) return { traceEvents: events };

  return {
    traceEvents: events.slice(0, finalIndex),
    finalResponse: events[finalIndex] as Extract<
      AgentTurnEvent,
      { kind: "response" }
    >,
  };
}

export function formatUsage(usage?: TurnUsage | null): string {
  if (!usage) return "";

  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const reasoning = usage.reasoning_tokens ?? 0;
  const cached = usage.cached_tokens ?? 0;

  const fmt = (value: number) =>
    value >= 1000
      ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`
      : String(value);

  return [
    `${fmt(input)} in`,
    `${fmt(output)} out`,
    reasoning > 0 ? `${fmt(reasoning)} think` : null,
    cached > 0 ? `${fmt(cached)} cached` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function parseLegacyTurn(content: string): AgentTurn {
  let rest = content;
  let secs = 0;
  let usage: TurnUsage | undefined;

  const workedMatch = /^\[worked:(\d+)s\]\s*/.exec(rest);
  if (workedMatch) {
    secs = parseInt(workedMatch[1], 10);
    rest = rest.slice(workedMatch[0].length);
  }

  const usageMatch = /^\[usage:(\d+)\/(\d+)\/(\d+)\/(\d+)\]\s*/.exec(rest);
  if (usageMatch) {
    usage = {
      prompt_tokens: Number(usageMatch[1]),
      completion_tokens: Number(usageMatch[2]),
      reasoning_tokens: Number(usageMatch[3]),
      cached_tokens: Number(usageMatch[4]),
    };
    rest = rest.slice(usageMatch[0].length);
  }

  const events: AgentTurnEvent[] = [];
  const marker =
    /<(think|thinking)>([\s\S]*?)<\/\1>|\[tool:([a-zA-Z_]+)(\([\s\S]*?\))?\]\s*<toolresult>([\s\S]*?)<\/toolresult>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(rest))) {
    const segment = rest.slice(last, match.index).trim();
    if (segment) events.push({ kind: "response", text: segment });

    if (match[1]) {
      events.push({ kind: "reasoning", text: (match[2] ?? "").trim() });
    } else {
      const name = match[3] ?? "tool";
      events.push({
        kind: "tool_call",
        name,
        args: (match[4] ?? "").replace(/^\(|\)$/g, ""),
      });
      events.push({
        kind: "tool_result",
        name,
        result: (match[5] ?? "").trim(),
      });
    }
    last = match.index + match[0].length;
  }

  const tail = rest.slice(last).trim();
  if (tail) events.push({ kind: "response", text: tail });

  const responses = events.filter(isMeaningfulResponse);
  const finalContent =
    responses.length > 0 ? responses[responses.length - 1].text : content;

  return { secs, usage, events, finalContent };
}
