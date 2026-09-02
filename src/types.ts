// Core domain types for Rcode

export type TaskType = "main" | "side_chat";
export type SessionStatus = "active" | "closed" | "promoted";
export type MessageRole = "user" | "assistant" | "system";

export interface Session {
  id: string;
  parentId: string | null;
  title: string;
  taskType: TaskType;
  status: SessionStatus;
  model: string;
  provider: string;
  customInstructions: string | null;
  createdAt: number;
  updatedAt: number;
  depth: number;
  sortOrder?: number;
  isPinned?: number;
  pinnedAt?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  versions?: string[];
  versionIndex?: number;
}

export interface SideChatTab {
  id: string;
  parentSessionId: string;
  sideChatId: string;
  tabOrder: number;
  isClosed: boolean;
  createdAt: number;
  sideChatTitle?: string;
  sideChatStatus?: SessionStatus;
  sideChatDepth?: number;
}

export interface Theme {
  preset: ThemePreset;
  accent: string;
  background: string;
  foreground: string;
  surface: string;
  sidebar: string;
  border: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  uiFont: string;
  codeFont: string;
  fontSizeScale: number;
  radius: number;
  translucentSidebar: boolean;
  contrast: "low" | "medium" | "high";
  darkMode: boolean;
}

export type ThemePreset = "unsloth-mint" | "rcode-blue" | "classic-dark" | "light-classic";

export interface Settings {
  reasoningEffort?: string;
  apiBase: string;
  apiKey: string;
  model: string;
  providerName: string;
  globalInstructions: string;
  theme: Theme;
}

export interface CreateSessionInput {
  parentId?: string | null;
  title?: string;
  taskType?: TaskType;
  model?: string;
  provider?: string;
  customInstructions?: string;
}

export interface CreateSideChatInput {
  parentSessionId: string;
  title?: string;
  model?: string;
  provider?: string;
  selectedText?: string;
}

export interface ChatChunk {
  content: string;
  done: boolean;
  reasoning?: string;
  kind?: "tool_call" | "tool_result";
  tool?: { name: string; args?: string; result?: string };
  secs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
}

export interface ChatRequest {
  sessionId: string;
  userMessage: string;
  model?: string;
  mode?: string;
  reasoningEffort?: string;
}

export const DEFAULT_THEME: Theme = {
  preset: "rcode-blue",
  accent: "#5DD1FF",
  background: "#161616",
  foreground: "#e5e5e5",
  surface: "#202020",
  sidebar: "#161616",
  border: "#ffffff1a",
  muted: "#a3a3a3",
  success: "#17B88B",
  warning: "#FACC15",
  danger: "#dc2626",
  uiFont: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  codeFont: "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
  fontSizeScale: 1.08,
  radius: 10,
  translucentSidebar: false,
  contrast: "medium",
  darkMode: true,
};

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "http://127.0.0.1:3459/v1",
  apiKey: "",
  model: "glm-5.2",
  providerName: "local-proxy",
  globalInstructions: "",
  theme: DEFAULT_THEME,
};

export const THEME_PRESETS: Record<ThemePreset, Theme> = {
  "unsloth-mint": {
    preset: "unsloth-mint",
    accent: "#17B88B",
    background: "#181818",
    foreground: "#ECECEC",
    surface: "#212121",
    sidebar: "#1F1F1F",
    border: "#303030",
    muted: "#9B9B9B",
    success: "#17B88B",
    warning: "#FFD60A",
    danger: "#FF5C5C",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 10,
    translucentSidebar: true,
    contrast: "medium",
    darkMode: true,
  },
  "rcode-blue": {
    preset: "rcode-blue",
    accent: "#5DD1FF",
    background: "#161616",
    foreground: "#e5e5e5",
    surface: "#202020",
    sidebar: "#161616",
    border: "#ffffff1a",
    muted: "#a3a3a3",
    success: "#17B88B",
    warning: "#FACC15",
    danger: "#dc2626",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 10,
    translucentSidebar: true,
    contrast: "medium",
    darkMode: true,
  },
  "classic-dark": {
    preset: "classic-dark",
    accent: "#3B82F6",
    background: "#0F0F0F",
    foreground: "#E5E5E5",
    surface: "#1E1E1E",
    sidebar: "#141414",
    border: "#2A2A2A",
    muted: "#8A8A8A",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 8,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: true,
  },
  "light-classic": {
    preset: "light-classic",
    accent: "#2563EB",
    background: "#FFFFFF",
    foreground: "#111111",
    surface: "#F8F8F8",
    sidebar: "#F0F0F0",
    border: "#E5E5E5",
    muted: "#6B7280",
    success: "#059669",
    warning: "#D97706",
    danger: "#DC2626",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 8,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: false,
  },
};

export function applyPreset(preset: ThemePreset, overrides: Partial<Theme> = {}): Theme {
  return { ...THEME_PRESETS[preset], ...overrides, preset };
}
