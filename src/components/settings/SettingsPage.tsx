/*
 * PURPOSE: Settings page with sidebar nav of categories
 *
 * Full-page layout (not a modal) — replaces the old SettingsModal.
 *
 * Layout (left to right):
 *   [back arrow] Rcode   | [API] [Theme] [Modes] [Hotkeys] [About] | right pane
 *   ^ left settings sidebar   ^ category icons + labels  ^ category content
 *
 * Uses lucide-react icons — no emojis, no inline SVGs.
 */

import { useState, useEffect } from "react";

import { useSettings } from "../../state/useSettings";

import { ThemeSettings } from "./ThemeSettings";
import { InstructionsEditor } from "./InstructionsEditor";
import { api } from "../../api/client";
import { MODELS } from "../../models";

import {
  ArrowLeftIcon,
  KeyIcon,
  PaletteIcon,
  BotIcon,
  KeyboardIcon,
  InfoIcon,
  CpuIcon,
  SparkleIcon,
  ShieldCheckIcon,
  Globe2Icon,
  HistoryIcon,
} from "../common/Icons";

type SettingsCategory =
  | "api"
  | "theme"
  | "model"
  | "modes"
  | "hotkeys"
  | "data"
  | "about";

interface CategoryDef {
  id: SettingsCategory;
  label: string;
  Icon: React.FC<{ size?: number; className?: string }>;
  description: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: "api",
    label: "API",
    Icon: KeyIcon,
    description: "Provider endpoint, credentials, default model",
  },
  {
    id: "theme",
    label: "Theme",
    Icon: PaletteIcon,
    description: "Colors, fonts, density",
  },
  {
    id: "model",
    label: "Model",
    Icon: CpuIcon,
    description: "Default model, sampling, fallbacks",
  },
  {
    id: "modes",
    label: "Modes",
    Icon: BotIcon,
    description: "Agent permission levels",
  },
  {
    id: "hotkeys",
    label: "Hotkeys",
    Icon: KeyboardIcon,
    description: "Keyboard shortcuts",
  },
  {
    id: "data",
    label: "Data",
    Icon: HistoryIcon,
    description: "Sessions, exports, storage",
  },
  {
    id: "about",
    label: "About",
    Icon: InfoIcon,
    description: "Version, licenses",
  },
];

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [active, setActive] = useState<SettingsCategory>("api");
  const { settings, updateSetting } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(280);

  useEffect(() => {
    api.getSetting("settingsSidebarWidth").then(v => {
      const n = parseInt(v ?? "", 10);
      if (!isNaN(n) && n >= 200 && n <= 480) setSidebarWidth(n);
    }).catch(() => {});
  }, []);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.min(480, Math.max(200, startW + delta));
      setSidebarWidth(next);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = ev.clientX - startX;
      const finalW = Math.min(480, Math.max(200, startW + delta));
      setSidebarWidth(finalW);
      api.setSetting("settingsSidebarWidth", String(finalW));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const category = CATEGORIES.find(c => c.id === active) ?? CATEGORIES[0];

  return (
    <div className="settings-page">
      {/* Left sidebar: back arrow + category nav */}
      <aside className="settings-sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <button
          className="settings-sidebar-back"
          onClick={onClose}
          aria-label="Back to chat"
        >
          <ArrowLeftIcon size={16} />
          <span>Back to app</span>
        </button>

        <div className="settings-search-wrap">
          <input className="settings-search" placeholder="Search settings..." />
        </div>

        <nav className="settings-sidebar-nav" aria-label="Settings categories">
          <div className="settings-nav-section">Personal</div>
          {CATEGORIES.map(c => {
            const Icon = c.Icon;
            const isActive = c.id === active;
            return (
              <button
                key={c.id}
                className={`settings-sidebar-item ${isActive ? "active" : ""}`}
                onClick={() => setActive(c.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} />
                <span className="settings-sidebar-item-label">{c.label}</span>
                {isActive && (
                  <span className="settings-sidebar-item-indicator" aria-hidden="true" />
                )}
              </button>
            );
          })}
          <div className="settings-nav-section" style={{marginTop:12}}>Integrations</div>
          <div className="settings-sidebar-item" style={{opacity:0.5, pointerEvents:'none'}}><span>Plugins</span></div>
          <div className="settings-sidebar-item" style={{opacity:0.5, pointerEvents:'none'}}><span>Browser</span></div>
          <div className="settings-nav-section" style={{marginTop:12}}>Coding</div>
        </nav>
      </aside>
      <div className="settings-sidebar-resizer" onMouseDown={handleResizerMouseDown} role="separator" aria-orientation="vertical" title="Drag to resize" />

      {/* Right pane: category content */}
      <main className="settings-content">
        <header className="settings-content-header">
          <h2 className="settings-content-title">{category.label}</h2>
          <p className="settings-content-desc">{category.description}</p>
        </header>

        <div className="settings-content-body">
          {active === "api" && (
            <div className="settings-section-block">
              <div className="settings-row">
                <label htmlFor="apiBase">API Base URL</label>
                <input
                  id="apiBase"
                  type="text"
                  defaultValue={settings.apiBase}
                  onBlur={e => updateSetting("apiBase", e.target.value)}
                  placeholder="http://127.0.0.1:3490/v1"
                />
              </div>

              <div className="settings-row">
                <label htmlFor="apiKey">API Key</label>
                <input
                  id="apiKey"
                  type="password"
                  defaultValue={settings.apiKey}
                  onBlur={e => updateSetting("apiKey", e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              <div className="settings-row">
                <label htmlFor="defaultModel">Default Model</label>
                <input
                  id="defaultModel"
                  type="text"
                  defaultValue={settings.model}
                  onBlur={e => updateSetting("model", e.target.value)}
                  placeholder="glm-5.2"
                />
              </div>

              <div className="settings-row">
                <label htmlFor="providerName">Provider Name</label>
                <input
                  id="providerName"
                  type="text"
                  defaultValue={settings.providerName}
                  onBlur={e => updateSetting("providerName", e.target.value)}
                  placeholder="local-proxy"
                />
              </div>
            </div>
          )}

          {active === "theme" && <ThemeSettings />}

          {active === "model" && (
            <div className="settings-section-block">
              <div className="settings-info-card">
                <CpuIcon size={20} />
                <div>
                  <div className="settings-info-title">Default model</div>
                  <div className="settings-info-meta">
                    Currently using <strong>{settings.model}</strong> via{" "}
                    {settings.providerName} — {settings.apiBase}
                  </div>
                </div>
              </div>
              <div className="settings-hint" style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
                <span>Select the default model — also available in the composer’s model pill.</span>
                <span style={{fontSize:11, color:'var(--color-muted)', border:'1px solid var(--color-border)', borderRadius:6, padding:'2px 6px', background:'var(--color-surface)'}}>{settings.apiBase}</span>
              </div>
              <div className="model-picker-grid" style={{display:'grid', gap:8, marginTop:4}}>
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { updateSetting("model", m.id); updateSetting("providerName", m.provider); }}
                    style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                      padding:'10px 12px', borderRadius:8, border: `1px solid ${settings.model===m.id?'var(--color-fg)':'var(--color-border)'}`,
                      background: settings.model===m.id?'color-mix(in srgb, var(--color-fg) 6%, transparent)':'var(--color-surface)',
                      textAlign:'left', cursor:'pointer'
                    }}
                  >
                <div>
                      <div style={{fontSize:13, fontWeight:600, color:'var(--color-fg)'}}>{m.name}</div>
                      <div style={{fontSize:11, color:'var(--color-muted)'}}>{m.providerLabel} · {m.description}</div>
              </div>
                    {settings.model===m.id && <span style={{fontSize:11, color:'var(--color-fg)', border:'1px solid var(--color-fg)', borderRadius:999, padding:'2px 6px'}}>Active</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {active === "modes" && (
            <div className="settings-section-block">
              <p className="settings-hint">
                Pick the agent permission level for new conversations. Switch
                per-conversation from the mode badge in the composer.
              </p>
              <div className="settings-mode-cards">
                <div className="settings-mode-card">
                  <ShieldCheckIcon size={18} />
                  <div>
                    <div className="settings-mode-card-title">Plan</div>
                    <div className="settings-mode-card-desc">
                      Read-only. Agent proposes a plan before taking action.
                    </div>
                  </div>
                </div>
                <div className="settings-mode-card">
                  <Globe2Icon size={18} />
                  <div>
                    <div className="settings-mode-card-title">Full access</div>
                    <div className="settings-mode-card-desc">
                      Agent can read, write, and execute commands without prompts.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === "hotkeys" && (
            <div className="settings-section-block">
              <HotkeyRow label="New chat" keys={["Ctrl", "N"]} />
              <HotkeyRow label="Search" keys={["Ctrl", "K"]} />
              <HotkeyRow label="Toggle sidebar" keys={["Ctrl", "B"]} />
              <HotkeyRow label="Settings" keys={["Ctrl", ","] } />
              <HotkeyRow label="Send message" keys={["Enter"]} />
              <HotkeyRow label="Newline in message" keys={["Shift", "Enter"]} />
            </div>
          )}

          {active === "data" && <InstructionsEditor />}

          {active === "about" && (
            <div className="settings-section-block">
              <div className="settings-info-card">
                <SparkleIcon size={20} />
                <div>
                  <div className="settings-info-title">Rcode v0.1.0</div>
                  <div className="settings-info-meta">
                    Minimal AI coding assistant. Native, local-first.
                  </div>
                </div>
              </div>
              <p className="settings-hint">
                Built with Electron + React + Radix UI primitives. SQLite for
                local session storage. Custom CSS design system on top of
                CSS variables.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function HotkeyRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="settings-hotkey-row">
      <span className="settings-hotkey-label">{label}</span>
      <span className="settings-hotkey-keys">
        {keys.map((k, i) => (
          <span key={i} className="settings-kbd">
            {k}
          </span>
        ))}
      </span>
    </div>
  );
}

