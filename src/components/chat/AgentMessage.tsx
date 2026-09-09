import { Message, MessageAction, MessageActions, MessageBranch, MessageBranchContent, MessageBranchNext, MessageBranchPage, MessageBranchPrevious, MessageBranchSelector, MessageContent, MessageResponse, MessageToolbar } from "@/components/ai-elements/message";

import { parseLegacyTurn } from "@/lib/agentTurn";
import type { AgentTurn, LiveStep, Message as RcodeMessage, TurnUsage } from "../../types";
import { AgentTurnView } from "./AgentTurnView";
import {
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  PenIcon,
  RefreshIcon,
  TrashIcon,
} from "../common/Icons";
import { useCallback, useState } from "react";

interface AgentMessageProps {
  message: RcodeMessage;
  liveSteps?: LiveStep[];
  liveUsage?: TurnUsage | null;
  streaming?: boolean;
  streamingContent?: string;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
  onRetry?: () => void;
  onFork?: () => void;
  onVersionChange?: (index: number) => void;
}

function messageTurn(
  message: RcodeMessage,
  liveSteps?: LiveStep[],
  liveUsage?: TurnUsage | null,
  streamingContent?: string
): AgentTurn {
  if (message.turn) return message.turn;

  const legacy = parseLegacyTurn(message.content);
  if (!liveSteps?.length) return legacy;

  return {
    ...legacy,
    usage: liveUsage ?? legacy.usage,
    events: liveSteps,
    finalContent: streamingContent ?? legacy.finalContent,
  };
}

export function AgentMessage({
  liveSteps,
  liveUsage,
  message,
  onEdit,
  onDelete,
  onFork,
  onRetry,
  onVersionChange,
  streaming = false,
  streamingContent,
}: AgentMessageProps) {
  const [copied, setCopied] = useState(false);
  const turn = messageTurn(message, liveSteps, liveUsage, streamingContent);
  const versions = message.turnVersions?.length ? message.turnVersions : [turn];
  const activeVersion = message.versionIndex ?? 0;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [message.content]);

  const content =
    message.role === "user" ? (
      <MessageContent>
        <MessageResponse>{message.content}</MessageResponse>
      </MessageContent>
    ) : versions.length > 1 ? (
      <MessageBranch
        defaultBranch={activeVersion}
        onBranchChange={onVersionChange}
      >
        <MessageBranchContent>
          {versions.map((version, index) => (
            <MessageContent key={`version-${index}`}>
              <AgentTurnView streaming={streaming && index === activeVersion} turn={version} />
            </MessageContent>
          ))}
        </MessageBranchContent>
        <MessageToolbar>
          <MessageActions>
            <MessageBranchSelector>
              <MessageBranchPrevious />
              <MessageBranchPage />
              <MessageBranchNext />
            </MessageBranchSelector>
          </MessageActions>
        </MessageToolbar>
      </MessageBranch>
    ) : (
      <MessageContent>
        <AgentTurnView streaming={streaming} turn={turn} />
      </MessageContent>
    );

  return (
    <Message from={message.role === "user" ? "user" : "assistant"}>
      {content}
      <MessageToolbar>
        <MessageActions>
          <MessageAction onClick={copy} tooltip="Copy">
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </MessageAction>
          {onEdit && (
            <MessageAction onClick={() => onEdit(message.content)} tooltip="Edit">
              <PenIcon size={14} />
            </MessageAction>
          )}
          {onRetry && !streaming && (
            <MessageAction onClick={onRetry} tooltip="Retry">
              <RefreshIcon size={14} />
            </MessageAction>
          )}
          {onFork && !streaming && (
            <MessageAction onClick={onFork} tooltip="Fork">
              <GitForkIcon size={14} />
            </MessageAction>
          )}
          {onDelete && (
            <MessageAction onClick={onDelete} tooltip="Delete">
              <TrashIcon size={14} />
            </MessageAction>
          )}
        </MessageActions>
      </MessageToolbar>
    </Message>
  );
}
