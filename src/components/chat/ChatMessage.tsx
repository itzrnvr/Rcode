/*
 * PURPOSE: Single chat message renderer — markdown + syntax highlighting
 *
 * Uses maintained libs (react-markdown + remark-gfm + rehype-highlight + highlight.js)
 * instead of bespoke regex — verified React 19 + Electron renderer (no inline scripts,
 * class-based highlight CSS, no dangerouslySetInnerHTML). Handles GFM tables/lists
 * and fenced code via highlight.js.
 *
 * CONSUMERS: chat/ChatView.tsx
 */

import { type ReactNode, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

import type { AgentTurn, AgentTurnEvent, MessageRole, TurnUsage } from "../../types";
import { CopyIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PenIcon, TrashIcon, RefreshIcon, GitForkIcon } from "../common/Icons";
import { parseTurn, ReasoningWidget, ToolCallWidget, ToolResultWidget, WorkedWidget, type LiveStep } from "./AgentTurn";

interface ChatMessageProps {
  role: MessageRole;
  content: string;
  turn?: AgentTurn;
  streaming?: boolean;
  reasoning?: string;
  onEdit?: (newContent: string) => void;
  onDelete?: () => void;
  versionIndex?: number;
  versionCount?: number;
  onPrevVersion?: () => void;
  onNextVersion?: () => void;
  onRetry?: () => void;
  liveSteps?: LiveStep[];
  workedSecs?: number | null;
  liveUsage?: TurnUsage | null;
  onFork?: () => void;
  mid?: string;
}

// Kept for non-markdown code blocks (tool args) and copy header — markdown code uses rehype-highlight
function CodeBlock({ lang, code, children }: { lang: string; code: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [code]);
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || "text"}</span>
        <button className="code-block-copy" onClick={onCopy} title="Copy">
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre><code>{children ?? code}</code></pre>
    </div>
  );
}

function renderMarkdown(text: string, key: string) {
  return (
    <ReactMarkdown
      key={key}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
          const match = /language-(\w+)/.exec(className || "");
          if (!match) return <code className={className} {...props}>{children}</code>;

          const isElementWithChildren = (value: unknown): value is { props: { children?: React.ReactNode } } =>
            !!value && typeof value === "object" && "props" in value;
          const extractRaw = (node: React.ReactNode): string => {
            if (typeof node === "string") return node;
            if (Array.isArray(node)) return node.map(extractRaw).join("");
            if (isElementWithChildren(node)) {
              const child = node.props.children;
              return child ? extractRaw(child) : "";
            }
            return "";
          };
          const raw = extractRaw(children).replace(/\n$/, "");
          return <CodeBlock lang={match[1]} code={raw}>{children}</CodeBlock>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function renderEvent(event: AgentTurnEvent, index: number, live = false): ReactNode {
  const delay = index * 40;
  if (event.kind === "reasoning") {
    return <ReasoningWidget key={`reasoning-${index}`} text={event.text} defaultOpen={live} delayMs={delay} />;
  }
  if (event.kind === "response") {
    return <div key={`response-${index}`} className="trace-response">{renderMarkdown(event.text, `markdown-${index}`)}</div>;
  }
  if (event.kind === "tool_call") {
    return <ToolCallWidget key={`tool-call-${index}`} step={event} delayMs={delay} />;
  }
  return <ToolResultWidget key={`tool-result-${index}`} step={event} delayMs={delay} />;
}

function renderTurn(turn: AgentTurn, collapsed: boolean, onToggle: () => void): ReactNode {
  const events = turn.events;
  const isMeaningfulResponse = (event: AgentTurnEvent): event is Extract<AgentTurnEvent, { kind: "response" }> =>
    event.kind === "response" && event.text.trim().length > 0;

  let finalResponseIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (isMeaningfulResponse(events[i])) {
      finalResponseIndex = i;
      break;
    }
  }

  const traceEvents = (finalResponseIndex >= 0 ? events.slice(0, finalResponseIndex) : events)
    .filter(event => event.kind !== "response" || isMeaningfulResponse(event));
  const finalResponse = finalResponseIndex >= 0 ? events[finalResponseIndex] : undefined;
  const finalText = finalResponse?.kind === "response" ? finalResponse.text : turn.finalContent;

  return (
    <>
      {traceEvents.length > 0 && (
        <WorkedWidget
          secs={turn.secs}
          usage={turn.usage}
          collapsed={collapsed}
          onToggle={onToggle}
        >
          {traceEvents.map((event, index) => renderEvent(event, index))}
        </WorkedWidget>
      )}
      {finalText && (
        <div className="message-response">{renderMarkdown(finalText, "final-response")}</div>
      )}
    </>
  );
}

export function ChatMessage({ role, content, turn, streaming, onEdit, onDelete, versionIndex, versionCount, onPrevVersion, onNextVersion, onRetry, onFork, liveSteps, liveUsage, mid }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [turnCollapsed, setTurnCollapsed] = useState(true);
  const [traceOpen, setTraceOpen] = useState<boolean | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const onCopyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [content]);

  const handleSaveEdit = useCallback(() => {
    if (onEdit && editValue.trim() && editValue !== content) onEdit(editValue.trim());
    setIsEditing(false);
  }, [onEdit, editValue, content]);
  const handleCancelEdit = useCallback(() => {
    setEditValue(content);
    setIsEditing(false);
  }, [content]);

  if (role === "system") {
    return (
      <div style={{ fontStyle: "italic", color: "var(--color-muted)", fontSize: 12, padding: "4px 0" }}>
        {content}
      </div>
    );
  }

  if (role === "user") {
    if (isEditing) {
      return (
        <div className="message-group message-group-user is-editing">
          <div className="message-edit-box">
            <textarea value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus rows={3} />
            <div className="message-edit-actions">
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save</button>
              <button className="btn" onClick={handleCancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="message-group message-group-user" data-mid={mid}>
        <div className="message-user">{content}</div>
        <div className="message-actions">
          <button className="message-action-btn" onClick={onCopyMessage} title={copied ? "Copied" : "Copy"}>
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </button>
          {onEdit && (
            <button className="message-action-btn" onClick={() => setIsEditing(true)} title="Edit">
              <PenIcon size={12} />
            </button>
          )}
          {onDelete && (
            <button className="message-action-btn danger" onClick={onDelete} title="Delete">
              <TrashIcon size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`message-group message-group-assistant ${streaming ? "stream-cursor" : ""}`} data-mid={mid}>
      {streaming && (() => {
        const steps = liveSteps ?? [];
        const collapsed = traceOpen ?? false;
        return (
          <WorkedWidget secs={0} live usage={liveUsage} collapsed={collapsed} onToggle={() => setTraceOpen(!collapsed)}>
            {steps.map((step, index) => renderEvent(step, index, true))}
          </WorkedWidget>
        );
      })()}
      {streaming && !content && <div className="thinking-row"><span className="tool-row-spinner" />Thinking…</div>}
      <div className="message-assistant">
        {isEditing ? (
          <div className="message-edit-box">
            <textarea value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus rows={4} />
            <div className="message-edit-actions">
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save</button>
              <button className="btn" onClick={handleCancelEdit}>Cancel</button>
            </div>
          </div>
        ) : streaming ? null : renderTurn(turn ?? parseTurn(content), turnCollapsed, () => setTurnCollapsed(c => !c))}
      </div>
      <div className="message-actions">
        <button className="message-action-btn" onClick={onCopyMessage} title={copied ? "Copied" : "Copy"}>
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
        {onRetry && !streaming && (
          <button className="message-action-btn" onClick={onRetry} title="Retry — generate a new response">
            <RefreshIcon size={12} />
          </button>
        )}
        {(versionCount ?? 1) > 1 && (
          <span className="message-version-nav" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <button className="message-action-btn" onClick={onPrevVersion} disabled={(versionIndex ?? 0) <= 0} title="Previous response" style={{ opacity: (versionIndex ?? 0) <= 0 ? 0.35 : 1 }}>
              <ChevronLeftIcon size={12} />
            </button>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{(versionIndex ?? 0) + 1}/{versionCount}</span>
            <button className="message-action-btn" onClick={onNextVersion} disabled={(versionIndex ?? 0) >= (versionCount ?? 1) - 1} title="Next response" style={{ opacity: (versionIndex ?? 0) >= (versionCount ?? 1) - 1 ? 0.35 : 1 }}>
              <ChevronRightIcon size={12} />
            </button>
          </span>
        )}
        {onFork && !streaming && (
          <button className="message-action-btn" onClick={onFork} title="Fork session from here">
            <GitForkIcon size={12} />
          </button>
        )}
        {onEdit && !isEditing && (
          <button className="message-action-btn" onClick={() => setIsEditing(true)} title="Edit">
            <PenIcon size={12} />
          </button>
        )}
        {onDelete && (
          <button className="message-action-btn danger" onClick={onDelete} title="Delete">
            <TrashIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
