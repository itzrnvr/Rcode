/*
 * PURPOSE: Root component — top-level route + sidebar collapse
 *
 * Two routes:
 *   - "chat" (default): 3-panel shell (sidebar + chat + optional side panel)
 *   - "settings": full SettingsPage with its own internal sidebar
 *
 * Sidebar collapse state lives here so both sidebar widths + rail icon
 * can stay in sync. Persisted to settings so reload remembers state.
 */

import { useState, useEffect, Component, type ReactNode } from "react";

import { AppProvider, useApp } from "./state/AppContext";
import { useTheme } from "./hooks/useTheme";
import { api } from "./api/client";

import { AppShell } from "./components/layout/AppShell";
import { TitleBar } from "./components/layout/TitleBar";
import { SessionList } from "./components/sessions/SessionList";
import { ChatView } from "./components/chat/ChatView";
import { SidePanel } from "./components/sidepanel/SidePanel";
import { SettingsPage } from "./components/settings/SettingsPage";
import { SearchPalette } from "./components/search/SearchPalette";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null } as { hasError: boolean; error: Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error("App render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: "#FF5C5C", fontFamily: "monospace" }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const { settings, showSettings, setShowSettings, bumpSessionList, sidePanelCollapsed, setSidePanelCollapsed, sidePanelWidth, setSidePanelWidth } = useApp();
  useTheme(settings.theme);

  const [route, setRoute] = useState<"chat" | "settings">("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [settingsCategory, setSettingsCategory] = useState<string | undefined>(undefined);
  const openSettingsAt = (cat?: string) => {
    setSettingsCategory(cat);
    setShowSettings(true);
  };
  // Seed demo session if DB is empty and first-run flag not set
  const [seedReady, setSeedReady] = useState(false);

  useEffect(() => {
    if (seedReady) return;
    api.getSetting("demoSeeded").then(async (v) => {
      if (v === "true") { setSeedReady(true); return; }
      const existing = await api.listMainSessions();
      if (existing.length === 0) {
        // Create demo session with realistic chat flow
        const session = await api.createSession({
          model: settings.model,
          provider: settings.providerName,
          title: "Welcome to Rcode",
        });
        await api.addMessage(
          session.id, "user",
          "How do I optimize a React component that re-renders too often?"
        );
        await api.addMessage(
          session.id, "assistant",
          "Three quick wins:\n\n1. **Memoize the component itself** with `React.memo` if its props are stable\n2. **Stabilize callbacks and objects** with `useCallback` / `useMemo` (or move them out of the render)\n3. **Split context** so consumers don't re-render on unrelated state changes\n\nUse the React DevTools Profiler to confirm before optimizing — never optimize blind."
        );
        await api.addMessage(
          session.id, "user",
          "Show me a real example combining all three."
        );
        await api.addMessage(
          session.id, "assistant",
          "Here is a Sidebar component rewritten with all three patterns:\n\n```tsx\nconst NavContext = createContext({ active: '' });\nconst UserContext = createContext({ user: null });\n\nfunction Sidebar() {\n  return (\n    <NavProvider>\n      <UserProvider>\n        <SidebarNav />\n        <SidebarUser />\n      </UserProvider>\n    </NavProvider>\n  );\n}\n\nconst SidebarNav = React.memo(function SidebarNav() {\n  const { active } = useContext(NavContext);\n  return <nav>{/* nav items */}</nav>;\n});\n\nconst SidebarUser = React.memo(function SidebarUser() {\n  const { user } = useContext(UserContext);\n  return <div>{user?.name}</div>;\n});\n```\n\nNow nav only re-renders when active changes, user only when user changes. **Both are isolated from each other.**"
        );
      }
      await api.setSetting("demoSeeded", "true");
      setSeedReady(true);
      // Force sidebar list to reload
      bumpSessionList();
    }).catch(() => setSeedReady(true));
  }, [seedReady, settings.model, settings.providerName]);

  useEffect(() => {
    api.getSetting("sidebarCollapsed")
      .then(v => { if (v === "true") setSidebarCollapsed(true); })
      .catch(() => {});
    api.getSetting("sidebarWidth")
      .then(v => { const n = parseInt(v ?? "", 10); if (!isNaN(n) && n >= 200 && n <= 480) setSidebarWidth(n); })
      .catch(() => {});

  }, []);

  useEffect(() => {
    setRoute(showSettings ? "settings" : "chat");
  }, [showSettings]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  useEffect(() => {
    const open = () => setIsSearchOpen(true);
    window.addEventListener("open-search-palette", open as EventListener);
    const openSettingsEv = (e: Event) => {
      const ce = e as CustomEvent<{ category?: string }>;
      openSettingsAt(ce.detail?.category);
    };
    window.addEventListener("open-settings", openSettingsEv as EventListener);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen(v => !v);
      }
    };
    window.addEventListener("keydown", onKey as EventListener);
    return () => {
      window.removeEventListener("open-search-palette", open as EventListener);
      window.removeEventListener("open-settings", openSettingsEv as EventListener);
      window.removeEventListener("keydown", onKey as EventListener);
    };
  }, []);

  const openSettings = () => setShowSettings(true);
  const closeSettings = () => setShowSettings(false);

  const toggleSidebar = async () => {
    const v = !sidebarCollapsed;
    setSidebarCollapsed(v);
    await api.setSetting("sidebarCollapsed", v ? "true" : "false");
  };
  const handleSidebarWidthChange = async (w: number) => {
    setSidebarWidth(w);
    await api.setSetting("sidebarWidth", String(w));
  };
  const toggleSidePanel = async () => {
    await setSidePanelCollapsed(!sidePanelCollapsed);
  };
  const handleSidePanelWidthChange = async (w: number) => {
    await setSidePanelWidth(w);
  };

  if (route === "settings") {
    return (
      <>
        <SettingsPage onClose={closeSettings} initialCategory={settingsCategory as never} />
        <SearchPalette open={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      </>
    );
  }

  return (
    <>
    <AppShell
      titleBar={
        <TitleBar onToggleSidebar={toggleSidebar} onToggleSidePanel={toggleSidePanel} />
      }
      sessions={
        <SessionList
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          width={sidebarCollapsed ? 52 : sidebarWidth}
        />
      }
      sidebarCollapsed={sidebarCollapsed}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={handleSidebarWidthChange}
      chat={<ChatView />}
      sidePanel={<SidePanel collapsed={sidePanelCollapsed} onToggleCollapse={toggleSidePanel} width={sidePanelWidth} />}
      sidePanelCollapsed={sidePanelCollapsed}
      sidePanelWidth={sidePanelWidth}
      onSidePanelWidthChange={handleSidePanelWidthChange}
      onToggleSidePanel={toggleSidePanel}
    />
    <SearchPalette open={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </ErrorBoundary>
  );
}