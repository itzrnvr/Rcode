/*
 * PURPOSE: Right side panel with multiple tab types
 *
 * Tabs:
 *   - Side chats (existing: sidechat tabs created from selected text)
 *   - Code (file browser + code snippets from agent)
 *   - Files (file attachments)
 *   - Web (web search results from tool use)
 *   - Logs (streaming logs / function calls)
 *
 * Tabs are user-switchable. Each tab renders its own content.
 * lucide-react icons throughout — no emojis.
 */

import { useState } from "react";

import { useApp } from "../../state/AppContext";
import { useSideChats } from "../../state/useSideChats";
import { api } from "../../api/client";

import {
  XIcon,
  MessageCircleIcon,
  Code2Icon,
  FolderOpenIcon,
  GlobeIcon,
  TerminalSquareIcon,
  PlusIcon,
} from "../common/Icons";

type TabId = "sidechats" | "code" | "files" | "web" | "logs";

const TABS: Array<{ id: TabId; label: string; Icon: React.FC<{ size?: number; className?: string }> }> = [
  { id: "sidechats", label: "Side chats", Icon: MessageCircleIcon },
  { id: "code", label: "Code", Icon: Code2Icon },
  { id: "files", label: "Files", Icon: FolderOpenIcon },
  { id: "web", label: "Web", Icon: GlobeIcon },
  { id: "logs", label: "Logs", Icon: TerminalSquareIcon },
];

const EMPTY_STATES: Record<TabId, { Icon: React.FC<{ size?: number; className?: string }>; title: string; desc: string }> = {
  sidechats: {
    Icon: MessageCircleIcon,
    title: "No side chats",
    desc: "Select text in the chat and right-click to spawn a side conversation.",
  },
  code: {
    Icon: Code2Icon,
    title: "No code snippets",
    desc: "Code from agent responses will appear here. Snippets are saved per side chat.",
  },
  files: {
    Icon: FolderOpenIcon,
    title: "No files",
    desc: "Attach files via the + button in the composer. They'll show up here.",
  },
  web: {
    Icon: GlobeIcon,
    title: "No web results",
    desc: "When the agent uses web search, the sources will be listed here.",
  },
  logs: {
    Icon: TerminalSquareIcon,
    title: "No logs",
    desc: "Tool execution logs and streaming output will appear here.",
  },
};

export function SidePanel() {
  const { currentSessionId, bumpSideChats, sideChatVersion } = useApp();
  const { tabs, closedTabs, reopenTab, closeTab } = useSideChats(currentSessionId, sideChatVersion);
  const [activeTab, setActiveTab] = useState<TabId>("sidechats");

  const handleCloseTab = async (tabId: string) => {
    await api.closeSideChatTab(tabId);
    bumpSideChats();
  };

  return (
    <aside className="panel-side sidepanel-tabs" aria-label="Side panel">
      {/* Tab strip */}
      <div className="sidepanel-tab-strip" role="tablist">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              className={`sidepanel-tab ${isActive ? "active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="sidepanel-tab-content" role="tabpanel">
        {activeTab === "sidechats" ? (
          <SideChatsTabContent
            tabs={tabs}
            closedTabs={closedTabs}
            onClose={handleCloseTab}
            onReopen={reopenTab}
          />
        ) : (
          <EmptyTab tabId={activeTab} />
        )}
      </div>
    </aside>
  );
}

function SideChatsTabContent({
  tabs,
  closedTabs,
  onClose,
  onReopen,
}: {
  tabs: ReturnType<typeof useSideChats>["tabs"];
  closedTabs: ReturnType<typeof useSideChats>["closedTabs"];
  onClose: (tabId: string) => void;
  onReopen: (tabId: string) => void;
}) {
  if (tabs.length === 0 && closedTabs.length === 0) {
    return <EmptyTab tabId="sidechats" />;
  }

  return (
    <div className="sidepanel-sidechats-tab">
      {tabs.length > 0 && (
        <div className="sidepanel-section">
          <div className="sidepanel-section-label">Active ({tabs.length})</div>
          {tabs.map(tab => (
            <div
              key={tab.id}
              className="sidechat-tab-item"
              title={tab.sideChatTitle ?? "Side chat"}
            >
              <MessageCircleIcon size={13} />
              <span className="sidechat-tab-item-title">
                {tab.sideChatTitle ?? "Untitled"}
              </span>
              <button
                className="sidechat-tab-item-close"
                onClick={() => onClose(tab.id)}
                title="Close"
                aria-label="Close tab"
              >
                <XIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {closedTabs.length > 0 && (
        <div className="sidepanel-section">
          <div className="sidepanel-section-label">Closed ({closedTabs.length})</div>
          {closedTabs.map(tab => (
            <div
              key={tab.id}
              className="sidechat-tab-item"
              title="Reopen side chat"
            >
              <MessageCircleIcon size={13} />
              <span className="sidechat-tab-item-title">
                {tab.sideChatTitle ?? "Untitled"}
              </span>
              <button
                className="sidechat-tab-item-close"
                onClick={() => onReopen(tab.id)}
                title="Reopen"
                aria-label="Reopen tab"
              >
                <PlusIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyTab({ tabId }: { tabId: TabId }) {
  const empty = EMPTY_STATES[tabId];
  const Icon = empty.Icon;
  return (
    <div className="sidepanel-empty-tab">
      <Icon size={32} className="sidepanel-empty-tab-icon" />
      <div className="sidepanel-empty-tab-title">{empty.title}</div>
      <div className="sidepanel-empty-tab-desc">{empty.desc}</div>
    </div>
  );
}