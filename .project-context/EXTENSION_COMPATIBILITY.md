# Pi extension compatibility assessment

Date: 2026-09-10  
Rcode engine: `@earendil-works/pi-coding-agent` through `electron/agent/pi-worker.mjs`  
Installed Pi version observed: `0.84.4`

## Current status: extensions are disabled

Rcode creates pi's `DefaultResourceLoader` with:

```ts
noExtensions: true
noSkills: true
noPromptTemplates: true
noThemes: true
noContextFiles: true
```

So the current answer is simple: Rcode is not currently compatible with Pi
extensions, including the community packages already configured in Pi.

Rcode also does not read Pi's global `settings.json`, package registry,
`~/.pi/agent/extensions/`, project `.pi/extensions/`, or package-managed
extension paths.

## Installed package sample

Your Pi settings have 28 active user packages. A source scan found that nearly
all expose extension APIs:

- Custom tools: 19 packages
- Commands: 22 packages
- Tool-call interception: 6 packages
- Providers: 6 packages
- TUI widgets/footer/header/editor: 18 packages
- Message renderers/autocomplete: 2 packages

Some notable ones:

| Package | Primary surface | Rcode compatibility today |
|---|---|---|
| `pi-hermes-memory` | tools + provider + command | Disabled |
| `@narumitw/pi-goal` | tools + command + status | Disabled |
| `@quintinshaw/pi-dynamic-workflows` | tools + TUI workflow widgets | Disabled |
| `@juicesharp/rpiv-todo` | tools + TUI widget | Disabled |
| `pi-web-access` | tools + command + TUI | Disabled |
| `@tintinweb/pi-subagents` | tools, renderer, autocomplete, TUI | Disabled |
| `@mjasnikovs/pi-task` | tools, provider, command, TUI | Disabled |
| `@nguyenquangthai/pi-omp-theme` | themes, TUI widgets, tool renderer | Disabled |
| `billion-context-pi` | tools, context handling, TUI | Disabled |
| `@firstpick/pi-themes-bundle` | themes | Disabled |

## Compatibility tiers if enabled

### Likely portable without major Rcode changes

- Lifecycle event listeners
- `tool_call` allow/block/rewrite hooks
- Custom tools registered through `pi.registerTool()`
- Session metadata and append-only session entry usage
- Compaction customization, if exposed by `AgentSession`

Rcode already renders generic Pi tool calls and results as typed widgets, so
custom tools should appear without a dedicated UI renderer.

### Partially compatible; needs a bridge

- `pi.registerCommand()`: Pi extensions register slash commands, but Rcode's
  composer has no Pi command registry or command menu.
- Permission prompts: `ctx.ui.confirm/select/input` need a web/desktop UI host.
- Status/footer/header widgets: Rcode has its own shell/composer UI.
- Custom editors/overlays: require an extension UI runtime.
- Autocomplete providers: require composer integration.
- Custom message renderers: require a renderer registry mapped to Rcode widgets.

### Not currently portable

- TUI-only components and terminal rendering extensions.
- Themes: Rcode uses its own theme engine and Pi themes are disabled.
- Context files, prompt templates, and skills: explicitly disabled.
- Provider extensions: Rcode registers its own provider/model registry and
  bypasses Pi's provider discovery.
- Package-managed extensions (`npm:...`, `git:...`): not read by Rcode.

## Recommended integration phases

1. **Safe tool/lifecycle compatibility**
   - Add an Extension settings page.
   - Enable discovery from trusted Pi paths and installed Pi packages.
   - Start with `noExtensions: false`.
   - Surface custom tools through Rcode's existing tool widgets.
   - Map tool-call blocks to visible deny/allow results.

2. **Command compatibility**
   - Aggregate `pi.registerCommand()` definitions.
   - Render them in the slash-command menu.
   - Execute through the extension command context.

3. **Interaction bridge**
   - Map `ctx.ui.confirm/select/input/notify` to Rcode dialogs/toasts.
   - Persist pending prompts across reloads.
   - Add explicit allow/always/deny controls for dangerous operations.

4. **Provider compatibility**
   - Let Pi provider extensions register models.
   - Merge them with Rcode's provider table.
   - Preserve API keys outside renderer-visible state.

5. **UI extension compatibility**
   - Implement only widget surfaces that make sense in Rcode.
   - Treat terminal/TUI overlays as unsupported unless a separate terminal host
     is added.
