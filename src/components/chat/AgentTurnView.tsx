import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader } from "@/components/ai-elements/chain-of-thought";
import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";

import { splitFinalResponse } from "@/lib/agentTurn";
import type { AgentTurn, AgentTurnEvent } from "../../types";

function parseToolArgs(args?: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
}

function renderEvent(event: AgentTurnEvent, index: number, streaming: boolean) {
  if (event.kind === "reasoning") {
    return (
      <Reasoning
        defaultOpen={streaming}
        isStreaming={streaming}
        key={`reasoning-${index}`}
      >
        <ReasoningTrigger />
        <ReasoningContent>{event.text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (event.kind === "response") {
    return <MessageResponse key={`response-${index}`}>{event.text}</MessageResponse>;
  }

  if (event.kind === "tool_call") {
    return (
      <Tool key={`tool-call-${index}`}>
        <ToolHeader
          state={event.status === "running" ? "input-streaming" : "input-available"}
          toolName={event.name}
          type="dynamic-tool"
        />
        <ToolContent>
          <ToolInput input={parseToolArgs(event.args)} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool key={`tool-result-${index}`}>
      <ToolHeader
        state={event.isError ? "output-error" : "output-available"}
        toolName={event.name}
        type="dynamic-tool"
      />
      <ToolContent>
        <ToolOutput
          errorText={event.isError ? event.result : undefined}
          output={event.result}
        />
      </ToolContent>
    </Tool>
  );
}

export function AgentTurnView({
  streaming = false,
  turn,
}: {
  streaming?: boolean;
  turn: AgentTurn;
}) {
  const { finalResponse, traceEvents } = splitFinalResponse(turn);
  const header = streaming
    ? "Working"
    : `Worked for ${turn.secs}s`;

  return (
    <>
      <ChainOfThought defaultOpen={streaming}>
        <ChainOfThoughtHeader>
          {header}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent className="rcode-worked-content">
          {traceEvents.map((event, index) => renderEvent(event, index, streaming))}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {finalResponse && <MessageResponse>{finalResponse.text}</MessageResponse>}
    </>
  );
}
