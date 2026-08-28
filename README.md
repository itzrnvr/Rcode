# Rcode

Minimal, fast desktop AI coding assistant. Native, local-first, with persistent side chats and a Codex-inspired composer.

![Rcode screenshot](./refs/chat-polished.png)

## Features

- **Persistent chats** — SQLite-backed sessions, side chats that survive restarts, promote to main
- **Nested side chats** — thread depth indicators, breadcrumb back
- **Codex-style composer** — `+` attach, `Full access` / `Plan` modes, model pill (`MiniMax-H3`, `Qwen`, `GLM`), mic + send
- **Rich thread** — markdown (GFM tables, lists), syntax highlighted code blocks with copy, reasoning/think blocks, tool-call pills
- **Message actions** — hover footer `Copy / Edit / Delete`, inline edit with `Save/Cancel`
- **Sessions** — pin to top, inline rename, archive, drag to reorder (persisted `sort_order`)
- **Settings** — full page with `API / Theme / Model / Modes / Hotkeys / Data / About`, searchable, resizable sidebar, polished sliders
- **Theming** — 4 presets (`zcode-blue`, `unsloth-mint`, `classic-dark`, `light-classic`) + live CSS vars, translucent sidebar, contrast
- **Local-first** — Electron + React + Radix primitives, `better-sqlite3` WAL, OpenAI-compatible proxy (`3459/v1`)

## Tech

- Electron 33 + React 19 + Vite 6 + Tailwind 3 + Radix UI + lucide-react
- `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js` (github-dark)
- SQLite via `better-sqlite3`, Tauri-style window chrome

## Quick start

```bash
npm install
npm run build   # tsc -p tsconfig.node.json && vite build
npx electron . --remote-debugging-port=9222
```

Dev with HMR:

```bash
npm run dev
# vite on 5173 + electron
```

## Settings

- `API` — `apiBase` (default `http://127.0.0.1:3459/v1`), `apiKey`, `model`, `providerName`
- `Theme` — presets, accent/background/surface/sidebar/border/muted, fonts, `fontSizeScale` (1.08 default, `calc(15px * var(--font-scale))`), radius
- Model picker in composer shows `6 available` and writes to `settings.model`

## Project structure

```
src/
  api/           # typed IPC client
  components/
    chat/        # ChatView, ChatMessage (markdown), ChatInput (composer)
    common/      # Icons (lucide only), Toggle
    layout/      # AppShell, TitleBar (traffic lights), resizers
    sessions/    # SessionList (pin/rename/archive + drag)
    settings/    # SettingsPage, ThemeSettings
    sidepanel/   # SidePanel tabs
  state/         # AppContext, useChat, useSessions, useSideChats, useSettings
  hooks/         # useTheme
electron/
  chat/          # systemPrompt, streamClient (SSE)
  db/            # sessions, messages, sideChats, settings (sort_order migration)
  ipc/           # sessions, messages, chat, settings, sideChats
```

## License

MIT — see `LICENSE`.
