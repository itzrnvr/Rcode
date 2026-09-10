/*
 * PURPOSE: Right side panel — Rcode tab system
 *
 * Tabs are dynamic instances: Terminal, Side conversation, Review, Browser.
 * Header has a dropdown (Search tabs... + Open tabs + Recently closed + New tab types).
 * Matches Images 1-5: red-box pane with pill tabs Terminal / Side conversation 1.
 */

import { useState, useEffect, useCallback } from "react";

import { useApp } from "../../state/AppContext";
import { api } from "../../api/client";
import { useSideChats } from "../../state/useSideChats";

import {
  XIcon,
  MessageCircleIcon,
  Code2Icon,
  GlobeIcon,
  TerminalSquareIcon,
  PlusIcon,
  SearchIcon,
  HistoryIcon,
  ActivityIcon,
  ChevronDownIcon,
} from "../common/Icons";
import { TerminalPane } from "./TerminalPane";
import { TrajectoryView } from "./TrajectoryView";
import { GitPanel } from "./GitPanel";
import { BrowserPane } from "./BrowserPane";
import { SideChatThread } from "./SideChatThread";

type ZTabType = "side-conversation" | "review" | "terminal" | "browser" | "trajectory";

interface ZTab {
  id: string;
  type: ZTabType;
  title: string;
  closedAt?: number;
}

const TAB_DEFS: Record<ZTabType, { label: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  "side-conversation": { label: "Side conversation", Icon: MessageCircleIcon },
  review: { label: "Review", Icon: Code2Icon },
  terminal: { label: "Terminal", Icon: TerminalSquareIcon },
  browser: { label: "Browser", Icon: GlobeIcon },
  trajectory: { label: "Trajectory", Icon: ActivityIcon },
};

function fmtAgo(ts?: number): string {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function SidePanel({ collapsed, width, onToggleCollapse }: { collapsed?: boolean; width?: number; onToggleCollapse?: () => void } = {}) {
  const { currentSessionId, sideChatVersion, settings, bumpSideChats, setHasSideChats } = useApp();
  const { tabs: sideTabs, closedTabs: sideClosedTabs, closeTab: closeSideChatTab, reopenTab: reopenSideChatTab } = useSideChats(currentSessionId, sideChatVersion);
  const [openTabs, setOpenTabs] = useState<ZTab[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [tabSearch, setTabSearch] = useState("");
  const [recentlyClosed, setRecentlyClosed] = useState<ZTab[]>([]);

  const activeTab = openTabs.find(t => t.id === activeId) ?? openTabs[0];

  // Sync real sideChats into pill bar: each SideChatTab becomes a ZTab.
  // Keeps non-side tabs (terminal/browser/review) untouched, replaces side-conversation pills with DB state.
  useEffect(() => {
    setOpenTabs(prev => {
      const hadPlaceholder = prev.some(t => t.type === "side-conversation" && t.id.startsWith("side-conversation-"));
      const keep = prev.filter(t => t.type !== "side-conversation");
      const mapped: ZTab[] = sideTabs.map(st => ({
        id: st.sideChatId,
        type: "side-conversation" as const,
        title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
      }));
      if (mapped.length === 0 && hadPlaceholder) {
        return [...keep, { id: "side-conversation-placeholder", type: "side-conversation" as const, title: "Side conversation" }];
      }
      return [...keep, ...mapped];
    });
    // Auto-select first side chat when it appears and terminal was active (so selection→Create is visible)
    if (sideTabs.length > 0 && (activeId === "" || activeId === "terminal")) {
      // don't auto-switch if user is on terminal/review/browser — only if no side pill was active
      const hasActiveSide = sideTabs.some(s => s.sideChatId === activeId);
      if (!hasActiveSide) setActiveId(sideTabs[0].sideChatId);
    }
  }, [sideTabs, activeId]);

  // Sync closed side chats into recentlyClosed picker (append, de-dupe, prune reopened)
  useEffect(() => {
    const mapped: ZTab[] = sideClosedTabs.map(st => ({
      id: st.sideChatId,
      type: "side-conversation" as const,
      title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
    }));
    setRecentlyClosed(prev => {
      const openIds = new Set(sideTabs.map(s => s.sideChatId));
      let next = prev.filter(p => !openIds.has(p.id));
      const byId = new Map(next.map(p => [p.id, p] as const));
      for (const m of mapped) if (!byId.has(m.id)) next = [...next, m];
      return next.slice(0, 10);
    });
  }, [sideClosedTabs, sideTabs]);

  const openNewTab = useCallback(async (type: ZTabType) => {
    // Side conversation = immediately fork a new side chat from the current session
    if (type === "side-conversation" && currentSessionId) {
      try {
        const parent = await api.getSession(currentSessionId);
        const result = await api.createSideChat({
          parentSessionId: currentSessionId,
          title: `Side: ${parent?.title ?? "chat"}`,
          model: settings.model,
          provider: settings.providerName,
        });
        bumpSideChats();
        setHasSideChats(true);
        setActiveId(result.session.id);
        setShowPicker(false);
        return;
      } catch (e) {
        console.error("create side chat failed", e);
      }
    }
    if (type === "trajectory") {
      const existing = openTabs.find(t => t.type === type);
      if (existing) {
        setActiveId(existing.id);
      } else {
        const nt: ZTab = { id: type, type, title: TAB_DEFS[type].label };
        setOpenTabs(prev => [nt, ...prev]);
        setActiveId(type);
      }
      setShowPicker(false);
      return;
    }
    const id = `${type}-${Date.now()}`;
    const title = TAB_DEFS[type].label + (type === "side-conversation" ? ` ${openTabs.filter(t => t.type === "side-conversation").length + 1}` : "");
    const nt: ZTab = { id, type, title };
    setOpenTabs(prev => [nt, ...prev]);
    setActiveId(id);
    setShowPicker(false);
  }, [openTabs, currentSessionId, settings.model, settings.providerName, bumpSideChats, setHasSideChats]);

  const closeTab = useCallback((id: string) => {
    const closing = openTabs.find(t => t.id === id);
    if (closing) setRecentlyClosed(prev => [{ ...closing, closedAt: Date.now() }, ...prev].slice(0, 8));
    const next = openTabs.filter(t => t.id !== id);
    setOpenTabs(next);
    if (activeId === id && next.length) setActiveId(next[0].id);
  }, [openTabs, activeId]);

  const reopenRecent = useCallback((tab: ZTab) => {
    setOpenTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
    setRecentlyClosed(prev => prev.filter(t => t.id !== tab.id));
  }, []);

  // Dismiss dropdowns on outside click
  useEffect(() => {
    if (!showPicker && !showManager) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-sp-menu]") && !el.closest("[data-sp-trigger]")) {
        setShowPicker(false);
        setShowManager(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [showPicker, showManager]);

  // Local close/reopen already refreshes via useSideChats internal refresh() — no bump needed (avoids double fetch)
  const handleCloseSideChat = async (tabId: string) => {
    try {
      // tabId here is a sideChatId; translate to the side_chat_tabs row id for the IPC
      const row = sideTabs.find(st => st.sideChatId === tabId) ?? sideClosedTabs.find(st => st.sideChatId === tabId);
      if (row) await closeSideChatTab(row.id);
    } catch (e) {
      console.error("closeSideChat failed", e);
    }
  };
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: ZTabType; sideChatId?: string }>;
      if (!ce.detail?.type) return;
      if (ce.detail.type === "side-conversation" && ce.detail.sideChatId) {
        setActiveId(ce.detail.sideChatId);
        setShowPicker(false);
        return;
      }
      openNewTab(ce.detail.type);
    };
    window.addEventListener("sidepanel:new-tab", handler as EventListener);
    return () => window.removeEventListener("sidepanel:new-tab", handler as EventListener);
  }, [openNewTab]);

  const handleReopenSideChat = async (tabId: string) => {
    try {
      await reopenSideChatTab(tabId);
    } catch (e) {
      console.error("reopenSideChat failed", e);
    }
  };

  return (
    <aside className="panel-side" aria-label="Side panel" style={{display: collapsed ? 'none' : 'flex', width: collapsed ? 0 : (width ? `${width}px` : undefined), minWidth: collapsed ? 0 : (width ? `${width}px` : undefined)}}>
      {/* Header — chevron (tab manager) + pills + plus (new tab) */}
      <div className="sidepanel-toolbar">
        <button
          className="sidepanel-icon-btn"
          data-sp-trigger="1"
          onClick={() => { setShowManager(v => !v); setShowPicker(false); }}
          title="Search tabs / resume closed tabs"
        ><ChevronDownIcon size={14} /></button>

        <div className="sidepanel-tab-rail">
          {openTabs.filter(t => TAB_DEFS[t.type]).map(t => {
            const Def = TAB_DEFS[t.type];
            return (
              <div className={`sidepanel-pill ${t.id === activeId ? "active" : ""}`} key={t.id}>
                <button
                  className="sidepanel-pill-open"
                  onClick={() => setActiveId(t.id)}
                  title={t.title}
                  type="button"
                >
                  <Def.Icon size={13} />
                  <span>{t.title}</span>
                </button>
                <button
                  aria-label={`Close ${t.title}`}
                  className="sidepanel-pill-close"
                  onClick={() => { if (t.type === "side-conversation") handleCloseSideChat(t.id); closeTab(t.id); }}
                  type="button"
                >
                  <XIcon size={11} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          className="sidepanel-icon-btn"
          data-sp-trigger="1"
          onClick={() => { setShowPicker(v => !v); setShowManager(false); }}
          title="Open a new tab"
        ><PlusIcon size={14} /></button>

        {showPicker && (
          <div className="sp-menu sidepanel-menu anchored-right" data-sp-menu="1">
            {(Object.keys(TAB_DEFS) as ZTabType[]).map(type => {
              const D = TAB_DEFS[type];
              return (
                <button className="sidepanel-menu-item" key={type} onClick={() => openNewTab(type)} type="button">
                  <D.Icon size={14} />{D.label}
                </button>
              );
            })}
          </div>
        )}

        {showManager && (() => {
          const q = tabSearch.toLowerCase();
          const open = openTabs.filter(t => TAB_DEFS[t.type] && (!q || t.title.toLowerCase().includes(q)));
          const closed = recentlyClosed.filter(t => !q || t.title.toLowerCase().includes(q));
          return (
            <div className="sp-menu sidepanel-menu manager" data-sp-menu="1">
              <div className="sidepanel-search">
                <span className="sidepanel-search-icon"><SearchIcon size={13} /></span>
                <input className="sidepanel-search-input" value={tabSearch} onChange={e => setTabSearch(e.target.value)} placeholder="Search tabs..." autoFocus />
              </div>
              <div className="sidepanel-menu-heading">Open tabs</div>
              {open.length === 0 && <div className="sidepanel-menu-empty">None</div>}
              {open.map(t => {
                const Def = TAB_DEFS[t.type];
                return (
                  <div className="sidepanel-menu-row" key={t.id}>
                    <button
                      className={`sidepanel-menu-item ${t.id === activeId ? "active" : ""}`}
                      onClick={() => { setActiveId(t.id); setShowManager(false); }}
                      type="button"
                    >
                      <Def.Icon size={13} />
                      <span className="sidepanel-menu-label">{t.title}</span>
                    </button>
                    <button
                      aria-label={`Close ${t.title}`}
                      className="sidepanel-pill-close"
                      onClick={() => { if (t.type === "side-conversation") handleCloseSideChat(t.id); closeTab(t.id); }}
                      type="button"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                );
              })}
              <div className="sidepanel-menu-heading">Recently closed tabs</div>
              {closed.length === 0 && <div className="sidepanel-menu-empty">None</div>}
              {closed.map(t => {
                const Def = TAB_DEFS[t.type];
                return (
                  <button className="sidepanel-menu-item muted" key={t.id} onClick={() => { reopenRecent(t); setShowManager(false); }} type="button">
                    <Def.Icon size={13} /><span className="sidepanel-menu-label">{t.title}</span><span className="sidepanel-menu-meta">{fmtAgo(t.closedAt)}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Content */}
      <div className="sidepanel-content">
        {!activeTab && (
          <div className="sidepanel-empty-state">
            <div className="sidepanel-empty-title">Open tab</div>
            <div className="sidepanel-empty-description">Choose a tab to open in the side pane.</div>
            {(Object.keys(TAB_DEFS) as ZTabType[]).map(type => {
              const D = TAB_DEFS[type];
              return (
                <button className="sidepanel-choice" key={type} onClick={() => openNewTab(type)} type="button">
                  <span className="sidepanel-choice-icon"><D.Icon size={15} /></span>
                  {D.label}
                </button>
              );
            })}
          </div>
        )}
        {activeTab?.type === "side-conversation" && (() => {
          const liveRow = sideTabs.find(st => st.sideChatId === activeTab.id);
          if (liveRow) {
            return <SideChatThread sessionId={activeTab.id} title={activeTab.title} />;
          }
          return (
            <div style={{flex:1, overflowY:'auto', padding:12}}>
              <div style={{fontSize:11, color:'#8a8a8a', marginBottom:8, textTransform:'uppercase', letterSpacing:0.5}}>Side conversations • {sideTabs.length} open • {sideClosedTabs.length} closed</div>
              {sideTabs.length === 0 && sideClosedTabs.length === 0 ? (
                <div style={{background:'#1e1e1e', border:'1px solid #262626', borderRadius:8, padding:12, minHeight:80}}>
                  <div style={{fontSize:13, color:'#e8e8e8'}}>No side chats yet. Select text in the main chat and right-click → Create side chat.</div>
                  <div style={{fontSize:12, color:'#8a8a8a', marginTop:6}}>Active tab: {activeTab.title}</div>
                </div>
              ) : (
                <>
                  {sideTabs.length > 0 && (
                    <div style={{display:'flex', flexDirection:'column', gap:6}}>
                      {sideTabs.map(t => (
                        <div
                          key={t.id}
                          onClick={() => setActiveId(t.sideChatId)}
                          title="Open this side chat in the panel"
                          style={{display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background: activeId === t.sideChatId ? '#252525' : '#1e1e1e', border:'1px solid #262626', borderRadius:8, cursor:'pointer'}}
                        >
                          <MessageCircleIcon size={12} />
                          <span style={{flex:1, fontSize:13, color:'#e8e8e8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.sideChatTitle ?? t.sideChatId.slice(0,8)}</span>
                          <button onClick={e => { e.stopPropagation(); handleCloseSideChat(t.sideChatId); closeTab(t.sideChatId); }} title="Close" style={{background:'transparent', border:'none', color:'#8a8a8a', cursor:'pointer', padding:2}}><XIcon size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {sideClosedTabs.length > 0 && (
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:11, color:'#8a8a8a', marginBottom:6}}>Recently closed</div>
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        {sideClosedTabs.map(t => (
                          <div key={t.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'#0f0f0f', border:'1px solid #1f1f1f', borderRadius:8, opacity:0.7}}>
                            <HistoryIcon size={12} />
                            <span style={{flex:1, fontSize:13, color:'#8a8a8a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.sideChatTitle ?? t.sideChatId.slice(0,8)}</span>
                            <button
                              onClick={async () => {
                                await handleReopenSideChat(t.id);
                                reopenRecent({ id: t.sideChatId, type: "side-conversation", title: t.sideChatTitle ?? t.sideChatId.slice(0, 8) });
                              }}
                              title="Reopen"
                              style={{background:'transparent', border:'1px solid #262626', borderRadius:6, color:'#e8e8e8', cursor:'pointer', padding:'2px 6px', fontSize:11}}
                            >Reopen</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
        {activeTab?.type === "trajectory" && <TrajectoryView sessionId={currentSessionId} />}
        {activeTab?.type === "terminal" && (
          <div style={{flex:1, minHeight:0, padding:12}}><TerminalPane terminalId={activeTab.id} /></div>
        )}
        {activeTab?.type === "review" && <GitPanel />}
        {activeTab?.type === "browser" && <BrowserPane />}
      </div>
    </aside>
  );
}
