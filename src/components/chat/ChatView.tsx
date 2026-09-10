import { useCallback, useEffect, useState } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

import { api } from "../../api/client";
import { useApp } from "../../state/AppContext";
import { useChat } from "../../state/useChat";
import { pendingAutosend } from "../sidepanel/SideChatThread";
import type { Message as RcodeMessage, Session } from "../../types";

import { AgentConversation } from "./AgentConversation";
import { AgentMessage } from "./AgentMessage";
import { AgentPromptInput } from "./AgentPromptInput";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BeakerIcon,
  ChevronDownIcon,
  CodeIcon,
  CompassIcon,
  FolderIcon,
  GitForkIcon,
  SparkleIcon,
} from "../common/Icons";

const QUICK_PROMPTS = [
  {
    title: "Explore an idea",
    prompt: "Help me explore an idea about distributed systems...",
  },
  {
    title: "Refactor code",
    prompt: "Review this code and suggest improvements:",
  },
  {
    title: "Debug an issue",
    prompt: "I'm getting an error. Here's the stack trace:",
  },
  {
    title: "Brainstorm",
    prompt: "Brainstorm 10 creative names for a project that...",
  },
];

export function ChatView() {
  const {
    bumpSessionList,
    bumpSideChats,
    currentSessionId,
    setCurrentSessionId,
    setHasSideChats,
    setSidePanelCollapsed,
    settings,
  } = useApp();

  const {
    deleteMessage,
    editMessage,
    error,
    isStreaming,
    liveSteps,
    messages,
    refreshMessages,
    resend,
    sendMessage,
    sendTo,
    setVersion,
    stopStream,
    streamingContent,
    streamingTargetId,
    turnUsage,
  } = useChat(currentSessionId);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  // During retry, the temporary streaming message takes the old response's
  // exact position. This prevents the model output from appearing as a new,
  // unrelated turn at the bottom of the transcript.
  const retryTargetIndex = isStreaming && streamingTargetId
    ? messages.findIndex(message => message.id === streamingTargetId)
    : -1;
  const retryPlaceholder: RcodeMessage = {
    id: `retry-streaming-${streamingTargetId ?? "target"}`,
    sessionId: currentSessionId ?? "",
    role: "assistant",
    content: streamingContent,
    createdAt: Date.now(),
  };
  const visibleMessages = retryTargetIndex === -1
    ? messages
    : Object.assign([...messages], { [retryTargetIndex]: retryPlaceholder });

  useEffect(() => {
    if (!currentSessionId) {
      setSession(null);
      return;
    }
    api.getSession(currentSessionId).then(nextSession => setSession(nextSession));
  }, [currentSessionId]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const createSideChat = useCallback(async () => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection || !currentSessionId || !session) return;

    const result = await api.createSideChat({
      parentSessionId: currentSessionId,
      title: selection.slice(0, 40),
      model: settings.model,
      provider: settings.providerName,
    });

    bumpSideChats();
    setHasSideChats(true);
    setMenu(null);
    setSidePanelCollapsed(false);
    window.dispatchEvent(
      new CustomEvent("sidepanel:new-tab", {
        detail: { type: "side-conversation", sideChatId: result.session.id },
      })
    );
  }, [
    bumpSideChats,
    currentSessionId,
    session,
    setHasSideChats,
    setSidePanelCollapsed,
    settings.model,
    settings.providerName,
  ]);

  const menuItems: ContextMenuItem[] = [
    { label: "Create side chat from selection", onClick: createSideChat },
  ];

  const handleSend = useCallback(
    async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
      const trimmed = text.trim();

      if (trimmed.toLowerCase() === "/compact") {
        if (!currentSessionId) return;
        try {
          await (
            api as unknown as {
              compactChat: (id: string) => Promise<{ summary: string }>;
            }
          ).compactChat(currentSessionId);
          await refreshMessages();
        } catch (cause) {
          console.error("compact failed", cause);
        }
        return;
      }

      if (trimmed.toLowerCase().startsWith("/side")) {
        if (!currentSessionId) return sendMessage(text, meta);

        const rest = trimmed.slice(5).trim();
        const title = rest
          ? rest.slice(0, 40)
          : `Side: ${session?.title?.slice(0, 24) ?? "branch"}`;

        try {
          const result = await api.createSideChat({
            parentSessionId: currentSessionId,
            title,
            model: settings.model,
            provider: settings.providerName,
          });

          bumpSideChats();
          setHasSideChats(true);
          await setSidePanelCollapsed(false);
          window.dispatchEvent(
            new CustomEvent("sidepanel:new-tab", {
              detail: { type: "side-conversation", sideChatId: result.session.id },
            })
          );
          if (rest) pendingAutosend.set(result.session.id, rest);
        } catch (cause) {
          console.error("side branch failed", cause);
        }
        return;
      }

      return sendMessage(text, meta);
    },
    [
      bumpSideChats,
      currentSessionId,
      refreshMessages,
      sendMessage,
      session,
      setHasSideChats,
      setSidePanelCollapsed,
      settings.model,
      settings.providerName,
    ]
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ cmd: string }>;
      if (custom.detail?.cmd) handleSend(custom.detail.cmd);
    };
    window.addEventListener("chat:slash", handler as EventListener);
    return () => window.removeEventListener("chat:slash", handler as EventListener);
  }, [handleSend]);

  const handleWelcomeSend = useCallback(
    async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
      if (!text.trim()) return;
      const nextSession = await api.createSession({
        model: settings.model,
        provider: settings.providerName,
        title: text.slice(0, 40),
      });
      setCurrentSessionId(nextSession.id);
      bumpSessionList();
      await sendTo(nextSession.id, text, meta);
      bumpSessionList();
    },
    [
      bumpSessionList,
      sendTo,
      setCurrentSessionId,
      settings.model,
      settings.providerName,
    ]
  );

  const handleFork = useCallback(
    async (messageId: string) => {
      if (!currentSessionId) return;
      try {
        const fork = await (
          api as unknown as {
            forkSession: (sessionId: string, mid: string) => Promise<{ id: string }>;
          }
        ).forkSession(currentSessionId, messageId);
        bumpSessionList();
        setCurrentSessionId(fork.id);
      } catch (cause) {
        console.error("fork failed", cause);
      }
    },
    [bumpSessionList, currentSessionId, setCurrentSessionId]
  );

  const emptyState = (
    <>
      <ConversationEmptyState
        description="Ask me to write code, brainstorm, debug, explain… or anything else."
        icon={<SparkleIcon size={44} />}
        title="What's on your mind?"
      />
      <div className="rcode-quick-prompts">
        <Suggestions>
          {QUICK_PROMPTS.map(prompt => (
            <Suggestion
              key={prompt.title}
              onClick={value => handleWelcomeSend(value)}
              suggestion={prompt.prompt}
            >
              {prompt.title}
            </Suggestion>
          ))}
        </Suggestions>
      </div>
    </>
  );

  return (
    <div className="panel-chat">
      <div className="chat-header">
        {session && session.depth > 0 && (
          <button
            className="chat-back-btn"
            onClick={() => session.parentId && setCurrentSessionId(session.parentId)}
            title="Back to parent"
          >
            <ArrowLeftIcon size={16} />
          </button>
        )}
        <span className="chat-title">{session?.title ?? "New chat"}</span>
        <HeaderPills />
        {session && session.depth > 0 && (
          <span className="chat-depth">depth {session.depth}</span>
        )}
        <button
          className="chat-header-toggle"
          title="Open trajectory viewer"
          onClick={() => {
            setSidePanelCollapsed(false);
            window.dispatchEvent(
              new CustomEvent("sidepanel:new-tab", { detail: { type: "trajectory" } })
            );
          }}
        >
          <ActivityIcon size={14} />
        </button>
        <button className="chat-header-toggle" title="More">
          <ChevronDownIcon size={14} />
        </button>
      </div>

      <AgentConversation onContextMenu={handleContextMenu}>
        {messages.length === 0 && !isStreaming ? emptyState : null}

        {visibleMessages.map((message, index) => {
          const isRetryPlaceholder =
            isStreaming && retryTargetIndex >= 0 && message.id === retryPlaceholder.id;
          const previousUser = message.role === "assistant"
            ? messages.slice(0, index).reverse().find(item => item.role === "user")
            : undefined;

          return (
            <AgentMessage
              key={message.id}
              liveSteps={isRetryPlaceholder ? liveSteps : undefined}
              liveUsage={isRetryPlaceholder ? turnUsage : undefined}
              message={message}
              onDelete={() => deleteMessage(message.id)}
              onEdit={nextContent => {
                if (message.role === "user") {
                  editMessage(message.id, nextContent).then(() => resend(message.id));
                } else {
                  editMessage(message.id, nextContent);
                }
              }}
              onFork={() => handleFork(message.id)}
              onRetry={
                message.role === "assistant" && previousUser
                  ? () => resend(previousUser.id)
                  : undefined
              }
              onVersionChange={nextIndex => setVersion(message.id, nextIndex)}
              streaming={isRetryPlaceholder || isStreaming}
              streamingContent={isRetryPlaceholder ? streamingContent : streamingContent}
            />
          );
        })}

        {isStreaming && retryTargetIndex === -1 && (
          <AgentMessage
            liveSteps={liveSteps}
            liveUsage={turnUsage}
            message={{
              id: `streaming-${currentSessionId ?? "root"}`,
              sessionId: currentSessionId ?? "",
              role: "assistant",
              content: streamingContent,
              createdAt: Date.now(),
            }}
            streaming
            streamingContent={streamingContent}
          />
        )}

        {isStreaming && retryTargetIndex === -1 && liveSteps.length === 0 && !streamingContent && (
          <Message from="assistant">
            <MessageContent>
              <Shimmer>Thinking…</Shimmer>
            </MessageContent>
          </Message>
        )}

        {error && (
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{`Error: ${error}`}</MessageResponse>
            </MessageContent>
          </Message>
        )}
      </AgentConversation>

      <AgentPromptInput
        key={`composer-${currentSessionId ?? "welcome"}`}
        onSend={currentSessionId ? handleSend : handleWelcomeSend}
        onStop={stopStream}
        streaming={isStreaming}
      />

      {menu && (
        <ContextMenu
          items={menuItems}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      )}
    </div>
  );
}

function HeaderPills() {
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [cwdName, setCwdName] = useState("");
  const [open, setOpen] = useState(false);

  const gitApi = api as unknown as {
    gitBranches: () => Promise<string[]>;
    gitCheckout: (branch: string) => Promise<{ ok: boolean }>;
    gitCwdName: () => Promise<string>;
    gitStatus: () => Promise<{ branch: string }>;
  };

  useEffect(() => {
    gitApi.gitCwdName().then(setCwdName).catch(() => {});
    gitApi.gitStatus().then(status => setBranch(status.branch)).catch(() => {});
  }, [gitApi]);

  const toggle = async () => {
    if (!open) {
      try {
        setBranches(await gitApi.gitBranches());
      } catch {}
    }
    setOpen(current => !current);
  };

  return (
    <span className="chat-header-pills">
      <span className="header-pill">
        <FolderIcon size={12} />
        {cwdName || "…"}
      </span>
      <button className="header-pill" onClick={toggle} title="Switch branch">
        <GitForkIcon size={12} />
        {branch || "…"}
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <span data-sp-menu="1" className="sp-menu">
          {branches.map(nextBranch => (
            <button
              key={nextBranch}
              onClick={async () => {
                setOpen(false);
                try {
                  await gitApi.gitCheckout(nextBranch);
                  setBranch(nextBranch);
                } catch {}
              }}
            >
              <GitForkIcon size={11} />
              {nextBranch}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
