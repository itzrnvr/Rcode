/*
 * PURPOSE: Right side panel — ZCode-like tab system
 *
 * Tabs are dynamic instances: zcode (terminal), Side conversation, Review, Browser, Terminal.
 * Header has a dropdown (Search tabs... + Open tabs + Recently closed + New tab types).
 * Matches Images 1-5: red-box pane with pill tabs zcode / Side conversation 1.
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
  SearchIcon,
  HistoryIcon,
} from "../common/Icons";

type ZTabType = "side-conversation" | "review" | "terminal" | "browser";

interface ZTab {
  id: string;
  type: ZTabType;
  title: string;
}

const TAB_DEFS: Record<ZTabType, { label: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  "side-conversation": { label: "Side conversation", Icon: MessageCircleIcon },
  review: { label: "Review", Icon: Code2Icon },
  terminal: { label: "Terminal", Icon: TerminalSquareIcon },
  browser: { label: "Browser", Icon: GlobeIcon },
};

export function SidePanel() {
  const { currentSessionId } = useApp();
  // Keep existing sidechat hook for data, but wrap in Z tabs
  const { tabs: sideTabs } = useSideChats(currentSessionId, 0);
  const [openTabs, setOpenTabs] = useState<ZTab[]>([
    { id: "zcode", type: "terminal", title: "zcode" },
  ]);
  const [activeId, setActiveId] = useState<string>("zcode");
  const [showPicker, setShowPicker] = useState(false);
  const [recentlyClosed, setRecentlyClosed] = useState<ZTab[]>([
    { id: "rc-1", type: "side-conversation", title: "Explore layout and CSS" },
    { id: "rc-2", type: "browser", title: "gypsy-dragon" },
  ]);

  const activeTab = openTabs.find(t => t.id === activeId) ?? openTabs[0];

  const openNewTab = (type: ZTabType) => {
    const id = `${type}-${Date.now()}`;
    const title = TAB_DEFS[type].label + (type === "side-conversation" ? ` ${openTabs.filter(t => t.type === "side-conversation").length + 1}` : "");
    const nt: ZTab = { id, type, title };
    setOpenTabs(prev => [...prev, nt]);
    setActiveId(id);
    setShowPicker(false);
  };

  const closeTab = (id: string) => {
    const closing = openTabs.find(t => t.id === id);
    if (closing) setRecentlyClosed(prev => [closing, ...prev].slice(0, 5));
    const next = openTabs.filter(t => t.id !== id);
    setOpenTabs(next);
    if (activeId === id && next.length) setActiveId(next[0].id);
  };

  const reopenRecent = (tab: ZTab) => {
    setOpenTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
    setRecentlyClosed(prev => prev.filter(t => t.id !== tab.id));
  };

  const handleCloseTab = async (tabId: string) => {
    await api.closeSideChatTab(tabId);
    bumpSideChats();
  };

  return (
    <aside className="panel-side" aria-label="Side panel" style={{display:'flex', flexDirection:'column', background:'#0a0a0a', borderLeft:'1px solid #1f1f1f'}}>
      {/* Header — zcode pill + + + dropdown (Image 2,3) */}
      <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderBottom:'1px solid #1f1f1f'}}>
        <button onClick={() => setShowPicker(v => !v)} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:'#1a1a1a', border:'1px solid #262626', color:'#e8e8e8', fontSize:13, flex:1}}>
          <span style={{opacity:0.6}}>⇄</span> {activeTab ? activeTab.title : "zcode"} <span style={{marginLeft:'auto', opacity:0.5}}>▾</span>
        </button>
        <button onClick={() => setShowPicker(true)} style={{width:28, height:28, borderRadius:6, background:'#1a1a1a', border:'1px solid #262626', color:'#e8e8e8', display:'flex', alignItems:'center', justifyContent:'center'}}><PlusIcon size={14} /></button>
        {showPicker && (
          <div style={{position:'absolute', top:44, right:10, width:320, background:'#1a1a1a', border:'1px solid #262626', borderRadius:12, padding:8, zIndex:20, boxShadow:'0 8px 24px rgba(0,0,0,0.5)'}}>
            <div style={{display:'flex', alignItems:'center', gap:8, padding:'6px 8px', background:'#0f0f0f', borderRadius:8, marginBottom:8}}>
              <SearchIcon size={14} style={{opacity:0.5}} /><input placeholder="Search tabs..." autoFocus style={{flex:1, background:'transparent', border:'none', outline:'none', color:'#e8e8e8', fontSize:13}} />
            </div>
            <div style={{fontSize:11, color:'#8a8a8a', padding:'4px 8px'}}>Open tabs</div>
            {openTabs.map(t => {
              const Def = TAB_DEFS[t.type];
              return (
                <button key={t.id} onClick={() => {setActiveId(t.id); setShowPicker(false);}} style={{display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:8, background: t.id===activeId ? '#252525' : 'transparent', border:'none', color:'#e8e8e8', textAlign:'left'}}>
                  <Def.Icon size={14} /><span style={{flex:1}}>{t.title}</span><span style={{fontSize:11, opacity:0.5}}>now</span><span onClick={e=>{e.stopPropagation(); closeTab(t.id);}} style={{padding:2}}><XIcon size={12} /></span>
                </button>
              );
            })}
            <div style={{fontSize:11, color:'#8a8a8a', padding:'8px 8px 4px', marginTop:6}}>Recently closed tabs</div>
            {recentlyClosed.map(t => (
              <button key={t.id} onClick={() => reopenRecent(t)} style={{display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:8, background:'transparent', border:'none', color:'#8a8a8a', textAlign:'left'}}>
                <HistoryIcon size={14} /><span style={{flex:1}}>{t.title}</span><span style={{fontSize:11, opacity:0.5}}>2h</span>
              </button>
            ))}
            <div style={{height:1, background:'#262626', margin:'8px 0'}} />
            <div style={{fontSize:11, color:'#8a8a8a', padding:'4px 8px'}}>Open tab</div>
            {(Object.keys(TAB_DEFS) as ZTabType[]).map(type => {
              const D = TAB_DEFS[type];
              return <button key={type} onClick={() => openNewTab(type)} style={{display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px', borderRadius:8, background:'transparent', border:'none', color:'#e8e8e8', textAlign:'left'}}><D.Icon size={14} />{D.label}</button>;
            })}
          </div>
        )}
      </div>

      {/* Pill tabs bar — zcode / Side conversation 1 (Image 5) */}
      <div style={{display:'flex', gap:6, padding:'8px 10px', borderBottom:'1px solid #1f1f1f', overflowX:'auto'}}>
        {openTabs.map(t => (
          <button key={t.id} onClick={() => setActiveId(t.id)} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background: t.id===activeId ? '#252525' : '#1a1a1a', border:'1px solid #262626', color: t.id===activeId ? '#fff' : '#8a8a8a', fontSize:12, whiteSpace:'nowrap'}}>
            <span style={{width:6, height:6, borderRadius:999, background: t.type==='terminal' ? '#3b82f6' : '#22c55e'}} />{t.title} <span onClick={e=>{e.stopPropagation(); closeTab(t.id);}} style={{marginLeft:4, opacity:0.6}}><XIcon size={10} /></span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1, overflowY:'auto', padding:12, background:'#0a0a0a'}}>
        {!activeTab && <div style={{color:'#8a8a8a', textAlign:'center', marginTop:40}}>Open tab<br/><span style={{fontSize:12}}>Choose a tab to open in the side pane.</span></div>}
        {activeTab?.type === "side-conversation" && (
          <div>
            <div style={{fontSize:13, color:'#8a8a8a', marginBottom:8}}>Side conversation — {activeTab.title}</div>
            <div style={{background:'#1a1a1a', border:'1px solid #262626', borderRadius:8, padding:12, minHeight:120}}>
              <div style={{fontSize:13, color:'#e8e8e8'}}>Side chats from selection will appear here. Select text in the main chat and right-click → Create side chat.</div>
            </div>
            <div style={{marginTop:12, background:'#1a1a1a', border:'1px solid #262626', borderRadius:12, padding:12, display:'flex', gap:8, alignItems:'center'}}>
              <input placeholder="Ask for follow-up changes" style={{flex:1, background:'transparent', border:'none', outline:'none', color:'#e8e8e8', fontSize:13}} />
              <span style={{fontSize:11, color:'#8a8a8a'}}>Full access</span><span style={{width:28, height:28, borderRadius:8, background:'#e8e8e8', display:'flex', alignItems:'center', justifyContent:'center', color:'#0a0a0a'}}>↑</span>
            </div>
          </div>
        )}
        {activeTab?.type === "terminal" && (
          <div style={{background:'#0f0f0f', border:'1px solid #262626', borderRadius:8, padding:12, fontFamily:'monospace', fontSize:12, color:'#e8e8e8', minHeight:200}}>
            <div style={{color:'#8a8a8a'}}>PowerShell 7.6.0</div>
            <div style={{marginTop:8, background:'#0a0a0a', padding:8, borderRadius:6, border:'1px solid #1f1f1f'}}>A new PowerShell stable release is available: v7.6.5<br/>Upgrade now, or check out the release page at:<br/>https://aka.ms/PowerShell-Release?tag=v7.6.5</div>
            <div style={{marginTop:12, display:'flex', gap:6, alignItems:'center', background:'#1a1a1a', padding:'6px 8px', borderRadius:6}}><span style={{background:'#3b82f6', color:'#fff', padding:'2px 6px', borderRadius:999, fontSize:11}}>  ...\zcode</span><span style={{background:'#1a1a1a', border:'1px solid #262626', padding:'2px 6px', borderRadius:999, fontSize:11}}> main ?</span><span style={{background:'#1a1a1a', border:'1px solid #262626', padding:'2px 6px', borderRadius:999, fontSize:11}}>⬢ v26.3.0</span><span style={{marginLeft:'auto', background:'#0f0f0f', padding:'2px 6px', borderRadius:999, fontSize:11}}>🕒 11:06</span></div>
            <div style={{marginTop:8, color:'#22c55e'}}>&gt; <span style={{background:'#1a1a1a', width:8, height:14, display:'inline-block', verticalAlign:'middle'}} /></div>
          </div>
        )}
        {activeTab?.type === "review" && <div style={{color:'#8a8a8a', fontSize:13}}>Review — diff + Changes +12330 -0 will render here.</div>}
        {activeTab?.type === "browser" && <div style={{color:'#8a8a8a', fontSize:13, textAlign:'center', marginTop:40}}>Browser — preview at http://192.168.1.100:63881/prototype-mobile.html</div>}
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