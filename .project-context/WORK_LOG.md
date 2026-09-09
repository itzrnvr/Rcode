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
