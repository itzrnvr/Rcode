# Project work log

## 2026-09-09 — Typed agent-turn rendering and persistence

### Problem

Assistant turns were persisted as one flattened `content` string with `<think>`,
`[worked:]`, `[usage:]`, and tool markers. The renderer then reconstructed the
turn by parsing that string. This caused several defects:

- reasoning and response were not separate typed fields;
- tool calls and tool results were merged into one row;
- multiple reasoning fragments produced multiple awkward Thought widgets;
- whitespace-only response deltas created empty trace rows;
- the Worked control was a header rather than a container for the full trace.

### Change

- Added `AgentTurn` and `AgentTurnEvent` domain types.
- Added `messages.turn_json` and `messages.turn_versions` SQLite columns.
- Persisted structured turns with ordered events:
  `reasoning`, `response`, `tool_call`, and `tool_result`.
- Kept `messages.content` as the final assistant answer only.
- Preserved retry/version history, including upgrades of legacy text versions.
- Rewrote the turn UI around a collapsible Worked container.
- Rendered reasoning, tool calls, tool results, and intermediate responses as
  separate ordered widgets; the final response renders outside Worked.
- Kept a compatibility parser for old flattened messages.
- Wrapped pi's stream function to reorder a same-chunk text/reasoning pair so
  reasoning is captured before the response.
- Ignored whitespace-only response deltas at capture and render time.

### Verification

- `npx tsc -p tsconfig.node.json --noEmit`: pass.
- `npx tsc -p tsconfig.json --noEmit`: pass.
- `npm run build`: pass.
- Fresh runtime console errors after reload: none.
- Reasoning-only live turn:
  persisted as `reasoning → response`, with `content = "PONG."`.
- Tool live turn:
  persisted as `reasoning → tool_call → tool_result → response`, with
  `content = "RCODE-CAPTURE-FILTER-OK"`.
- Live UI displayed:
  Worked container → Reasoning → Tool call → Tool result, with the final
  response outside Worked.

### Remaining known notes

- The global CSS detector reports pre-existing warnings in unrelated areas:
  spring easing, width transitions, and old side-tab accent stripes. They are
  outside this change and were not modified.
- Vite reports the existing renderer bundle is over 500 kB and warns about
  code splitting; no bundle-size regression was introduced by this work.

## 2026-09-09 — AI Elements chat-surface refactor

### Change

- Replaced the hand-built chat transcript, message, reasoning, tool, and
  composer implementations with AI Elements/shadcn primitives:
  - `Conversation`, `ConversationContent`, `ConversationEmptyState`, and
    `ConversationScrollButton` for stick-to-bottom transcript behavior.
  - `Message`, `MessageContent`, `MessageResponse`, `MessageActions`, and
    `MessageBranch` for message layout and actions.
  - `Reasoning`, `Tool`, and `ChainOfThought` for collapsible typed events.
  - `PromptInput`, `PromptInputTextarea`, `PromptInputSelect`, and
    `PromptInputSubmit` for composer behavior.
- Added thin Rcode adapters:
  - `AgentConversation`
  - `AgentMessage`
  - `AgentTurnView`
  - `AgentPromptInput`
- Removed the old custom chat components:
  - `ChatMessage`
  - `ChatInput`
  - `AgentTurn` UI widgets
- Kept the typed event model and exact arrival order.
- Kept a small legacy-turn parser in `src/lib/agentTurn.ts`.
- Added Tailwind 3-compatible shadcn theme mappings and
  `tailwindcss-animate`.
- Pruned unused AI Elements registry components and dependencies.

### Verification

- Renderer TypeScript: pass.
- Electron/main TypeScript: pass.
- Production build: pass.
- Live renderer errors after reload: none.
- Real reasoning-only turn:
  `reasoning → response`, final answer `PONG.`
- Real tool turn:
  `tool_call → tool_result → response`, final answer
  `RCODE-AI-ELEMENTS-OK`.
- UI showed the separate prebuilt Tool call and Tool result widgets inside the
  collapsible Worked trace.

### Remaining known notes

- The production bundle is still large because the AI Elements `Tool` component
  imports the Shiki-based `CodeBlock`. A future optimization should lazy-load
  code highlighting or replace the heavy highlighter in tool outputs.
- The first automated accessibility click on the prebuilt submit button did not
  dispatch form submission, but native pointer clicks and
  `form.requestSubmit()` both worked. The nested-button tooltip composition
  was fixed; this appears to be an automation targeting quirk, not a user-facing
  submit failure.

## 2026-09-09 — Rcode/ZCode decoupling and interaction stabilization

### Change

- Removed Rcode's ZCode importer, IPC handlers, preload API, sidebar button,
  and all reads of `~/.zcode`.
- Added a migration that drops Rcode's obsolete internal ZCode import mapping
  table. Imported Rcode sessions remain untouched.
- Replaced the bare model select with the prebuilt AI Elements model selector:
  searchable dialog, grouped providers, selected state, and provider labels.
- Styled mode/effort selectors and the model trigger inside the composer.
- Hardened the pi worker pipe:
  - stdin/stdout/child failures now reject active turns;
  - failed writes reset the worker so the next turn can reconnect;
  - renderer sends are skipped if the sender window is destroyed.
- Fixed retry/version persistence for structured turns.
- Fixed fork persistence to generate new message IDs while preserving typed
  reasoning/response/tool events and version arrays.
- Added real inline edit states for user and assistant messages.
- Synced the prebuilt branch selector with Rcode's authoritative version index.
- Added indentation and a subtle left gutter inside Worked; removed broad hover
  highlighting so only interactive triggers signal hover.

### Verification

- Renderer TypeScript: pass.
- Electron/main TypeScript: pass.
- Production build: pass.
- Live retry: created a structured branch and displayed prev/next controls.
- Live branch switching: restored prior/new turn variants.
- Live user edit: saved edited prompt, resent, and appended a new structured
  response version.
- Live fork: copied typed user/assistant turns with newly generated message IDs.
- Renderer runtime errors after reload: none.

## 2026-09-09 — Canonical repair for fragmented pi streams

### Problem

MiniMax/pi delivered the fork test as:

1. reasoning text
2. response delta `F`
3. more reasoning text
4. response delta `ORK-OK`

Rcode treated the last non-empty response fragment as the whole final answer.
This produced nested/incomplete Thought widgets inside Worked and persisted
`ORK-OK` instead of `FORK-OK`.

### Change

- pi's worker now emits the canonical `thinking` and `text` content blocks from
  each completed assistant message via a new `assistant_end` chunk.
- Live renderer chunks still preserve the raw provider arrival order.
- At message completion, Rcode replaces only the current assistant segment after
  the last tool result with pi's canonical blocks.
- Earlier tool-call/tool-result history remains untouched.
- The active final response is taken from the canonical completed assistant
  message, not from the latest arbitrary stream fragment.
- Repaired the existing fork verification row from pi's durable session
  transcript so its stored turn and final answer are `FORK-OK`.

### Verification

- Electron/main TypeScript: pass.
- Renderer TypeScript: pass.
- Production build: pass.
- Existing repaired fork renders one Worked widget, one Thought child, and one
  `FORK-OK` response outside Worked.
- Worked content retains `16px` indentation and `14px` left padding.
- Fresh live turn with the same model persisted one complete reasoning event and
  one complete response event; final content was `PING`.
