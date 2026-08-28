/*
 * PURPOSE: Right side panel — ZCode-like tab system
 *
 * Tabs are dynamic instances: zcode (terminal), Side conversation, Review, Browser, Terminal.
 * Header has a dropdown (Search tabs... + Open tabs + Recently closed + New tab types).
 * Matches Images 1-5: red-box pane with pill tabs zcode / Side conversation 1.
 */

import { useState, useEffect } from "react";

import { useApp } from "../../state/AppContext";
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
  const { currentSessionId, sideChatVersion } = useApp();
  const { tabs: sideTabs, closedTabs: sideClosedTabs, closeTab: closeSideChatTab, reopenTab: reopenSideChatTab } = useSideChats(currentSessionId, sideChatVersion);
  const [openTabs, setOpenTabs] = useState<ZTab[]>([
    { id: "zcode", type: "terminal", title: "zcode" },
  ]);
  const [activeId, setActiveId] = useState<string>("zcode");
  const [showPicker, setShowPicker] = useState(false);
  const [recentlyClosed, setRecentlyClosed] = useState<ZTab[]>([]);

  const activeTab = openTabs.find(t => t.id === activeId) ?? openTabs[0];

  // Sync real sideChats into pill bar: each SideChatTab becomes a ZTab.
  // Keeps non-side tabs (terminal/browser/review) untouched, replaces side-conversation pills with DB state.
  useEffect(() => {
    setOpenTabs(prev => {
      const keep = prev.filter(t => t.type !== "side-conversation");
      const mapped: ZTab[] = sideTabs.map(st => ({
        id: st.id,
        type: "side-conversation" as const,
        title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
      }));
      // If no real side chats, preserve a single placeholder pill so the picker/list has a target
      if (mapped.length === 0 && keep.length === prev.length) return prev;
      if (mapped.length === 0) return keep.length ? keep : prev;
      return [...keep, ...mapped];
    });
    // Auto-select first side chat when it appears and terminal was active (so selection→Create is visible)
    if (sideTabs.length > 0 && activeId === "zcode") {
      // don't auto-switch if user is on terminal/review/browser — only if no side pill was active
      const hasActiveSide = sideTabs.some(s => s.id === activeId);
      if (!hasActiveSide) setActiveId(sideTabs[0].id);
    }
  }, [sideTabs, activeId]);

  // Sync closed side chats into recentlyClosed picker (append, de-dupe, prune reopened)
  useEffect(() => {
    const mapped: ZTab[] = sideClosedTabs.map(st => ({
      id: st.id,
      type: "side-conversation" as const,
      title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
    }));
    setRecentlyClosed(prev => {
      const openIds = new Set(sideTabs.map(s => s.id));
      let next = prev.filter(p => !openIds.has(p.id));
      const byId = new Map(next.map(p => [p.id, p] as const));
      for (const m of mapped) if (!byId.has(m.id)) next = [...next, m];
      return next.slice(0, 10);
    });
  }, [sideClosedTabs, sideTabs]);

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

  // Local close/reopen already refreshes via useSideChats internal refresh() — no bump needed (avoids double fetch)
  const handleCloseSideChat = async (tabId: string) => {
    try {
      await closeSideChatTab(tabId);
    } catch (e) {
      console.error("closeSideChat failed", e);
    }
  };
  const handleReopenSideChat = async (tabId: string) => {
    try {
      await reopenSideChatTab(tabId);
    } catch (e) {
      console.error("reopenSideChat failed", e);
    }
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
              <span style={{opacity:0.5, display:'flex'}}><SearchIcon size={14} /></span><input placeholder="Search tabs..." autoFocus style={{flex:1, background:'transparent', border:'none', outline:'none', color:'#e8e8e8', fontSize:13}} />
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
            <div style={{fontSize:11, color:'#8a8a8a', marginBottom:8, textTransform:'uppercase', letterSpacing:0.5}}>Side conversations • {sideTabs.length} open • {sideClosedTabs.length} closed</div>
            {sideTabs.length === 0 && sideClosedTabs.length === 0 ? (
              <div style={{background:'#1a1a1a', border:'1px solid #262626', borderRadius:8, padding:12, minHeight:80}}>
                <div style={{fontSize:13, color:'#e8e8e8'}}>No side chats yet. Select text in the main chat and right-click → Create side chat.</div>
                <div style={{fontSize:12, color:'#8a8a8a', marginTop:6}}>Active tab: {activeTab.title}</div>
              </div>
            ) : (
              <>
                {sideTabs.length > 0 && (
                  <div style={{display:'flex', flexDirection:'column', gap:6}}>
                    {sideTabs.map(t => (
                      <div key={t.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'#1a1a1a', border:'1px solid #262626', borderRadius:8}}>
                        <MessageCircleIcon size={12} />
                        <span style={{flex:1, fontSize:13, color:'#e8e8e8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.sideChatTitle ?? t.sideChatId.slice(0,8)}</span>
                        <button onClick={() => handleCloseSideChat(t.id)} title="Close" style={{background:'transparent', border:'none', color:'#8a8a8a', cursor:'pointer', padding:2}}><XIcon size={12} /></button>
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
                          <button onClick={() => handleReopenSideChat(t.id)} title="Reopen" style={{background:'transparent', border:'1px solid #262626', borderRadius:6, color:'#e8e8e8', cursor:'pointer', padding:'2px 6px', fontSize:11}}>Reopen</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
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