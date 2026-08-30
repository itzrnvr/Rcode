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

import type { MessageRole } from "../../types";
import { CopyIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PenIcon, TrashIcon, RefreshIcon } from "../common/Icons";
import { parseTurn, ToolRow, TurnHeader, type LiveStep } from "./AgentTurn";

interface ChatMessageProps {
  role: MessageRole;
  content: string;
  streaming?: boolean;
  model?: string;
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
  liveUsage?: import("./AgentTurn").TurnUsage | null;
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

export function ThinkingBlock({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`thinking-block ${open ? "open" : ""}`}>
      <button className="thinking-toggle" onClick={() => setOpen(o => !o)}>
        <ChevronDownIcon size={12} className={open ? "rotate-180" : ""} />
        <span>{open ? "Hide reasoning" : "Show reasoning"}</span>
      </button>
      {open && <div className="thinking-content">{content}</div>}
    </div>
  );
}

function ToolCallBlock({ name, args, result }: { name: string; args: string; result?: string }) {
  return (
    <div className="tool-call-block">
      <div className="tool-call-header">
        <span className="tool-call-name">{name}</span>
        <span className="tool-call-status">completed</span>
      </div>
      {args && <pre className="tool-call-args"><code>{args}</code></pre>}
      {result != null && (
        <pre className="tool-call-result"><code>{result}</code></pre>
      )}
    </div>
  );
}

function renderContent(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Agent turn markers: [worked:NNs] + [tool:...] + <toolresult> blocks
  const { workedSecs, steps, usage: parsedUsage } = parseTurn(content);
  let key0 = 0;
  if (workedSecs != null || steps.some(s => s.kind !== "say")) {
    nodes.push(<TurnHeader key={`turn-${key0++}`} secs={workedSecs} usage={parsedUsage} />);
  }
  let key = 0;

  for (const s of steps) {
    if (s.kind === "say") {
      nodes.push(
        <ReactMarkdown
          key={`md-${key++}`}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = !!match;
            if (isBlock) {
              const lang = match![1];
              // children are hljs-* spans from rehype-highlight — render them directly,
              // but keep raw string for copy. Extract raw text recursively.
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
              return <CodeBlock lang={lang} code={raw}>{children}</CodeBlock>;
            }
            return <code className={className} {...props}>{children}</code>;
          },
        }}
      >
          {s.text ?? ""}
        </ReactMarkdown>
      );
    } else if (s.kind === "tool") {
      nodes.push(<ToolRow key={`step-${key++}`} step={s} />);
    } else {
      nodes.push(<ThinkingBlock key={`step-${key++}`} content={s.text ?? ""} />);
    }
  }

  return nodes;
}

export function ChatMessage({ role, content, streaming, model, reasoning, onEdit, onDelete, versionIndex, versionCount, onPrevVersion, onNextVersion, onRetry, liveSteps, workedSecs, liveUsage }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
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
      <div className="message-group message-group-user">
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
    <div className={`message-group message-group-assistant ${streaming ? "stream-cursor" : ""}`}>
      {model && <div className="message-model">{model}</div>}
      {streaming && <TurnHeader secs={null} live usage={liveUsage} />}
      {streaming && liveSteps?.map((s, i) => s.kind === "tool"
        ? <ToolRow key={`live-${i}`} step={s} />
        : s.kind === "thought"
          ? <ThinkingBlock key={`live-${i}`} content={s.text ?? ""} defaultOpen />
          : <div key={`live-${i}`} className="message-assistant" style={{ padding: 0 }}>{renderContent(s.text ?? "")}</div>)}
      {streaming && !content && <div className="thinking-row"><span className="tool-row-spinner" />Thinking…</div>}
      {reasoning && !streaming && <ThinkingBlock content={reasoning} />}
      <div className="message-assistant">
        {isEditing ? (
          <div className="message-edit-box">
            <textarea value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus rows={4} />
            <div className="message-edit-actions">
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save</button>
              <button className="btn" onClick={handleCancelEdit}>Cancel</button>
            </div>
          </div>
        ) : streaming ? null : (
          renderContent(content)
        )}
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
