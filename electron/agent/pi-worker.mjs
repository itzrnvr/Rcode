/*
 * pi-worker — runs @earendil-works/pi-coding-agent under SYSTEM node.
 *
 * Why a worker: pi's dist uses Node 24+ APIs (webidl.util.markAsUncloneable)
 * that Electron 41's embedded Node lacks, so in-process import fails inside
 * the Electron main. System node loads it fine, so Rcode spawns this file and
 * speaks JSON lines over stdio.
 *
 * Protocol (one JSON object per line):
 *   → {id, op:"ping"}
 *   → {id, op:"prompt", sid, prompt, provider:{id,baseUrl,apiKey}, modelId,
 *      modelList, cwd, systemPrompt, mode, effort}
 *   → {op:"drop", sid}
 *   → {id, op:"compact", sid}
 *   ← {id, kind:"text"|"reasoning", delta}
 *   ← {id, kind:"tool_start", toolName, args}
 *   ← {id, kind:"tool_end", toolName, result, isError}
 *   ← {id, kind:"usage", usage:{input,output}}
 *   ← {id, kind:"error", message}
 *   ← {id, kind:"end"}
 *
 * Sessions persist to disk (Rcode/pi-sessions) so agent context survives
 * restarts; a map file links Rcode session ids -> pi session files.
 */
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const PI_PKG = "C:/Users/babys/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent";
const pi = (await import(pathToFileURL(join(PI_PKG, "dist/index.js")).href));
const piCore = (await import(pathToFileURL(join(PI_PKG, "node_modules/@earendil-works/pi-agent-core/dist/index.js")).href));

// sid -> {session, currentId}
const sessions = new Map();

// --- session persistence -----------------------------------------------------
const DATA_DIR = join(process.env.APPDATA ?? join(homedir(), ".config"), "Rcode");
const SESSION_DIR = join(DATA_DIR, "pi-sessions");
const MAP_FILE = join(DATA_DIR, "pi-session-map.json");

function loadSessionMap() {
  try { return JSON.parse(readFileSync(MAP_FILE, "utf8")); } catch { return {}; }
}
function saveSessionMap(map) {
  try { writeFileSync(MAP_FILE, JSON.stringify(map, null, 2)); } catch { /* non-fatal */ }
}
function openOrCreateSessionManager(sid, cwd) {
  mkdirSync(SESSION_DIR, { recursive: true });
  const map = loadSessionMap();
  const existing = map[sid];
  if (existing && existsSync(existing)) {
    try { return pi.SessionManager.open(existing, SESSION_DIR, cwd); } catch { /* fall through to fresh */ }
  }
  const mgr = pi.SessionManager.create(cwd, SESSION_DIR);
  if (mgr.sessionFile) { map[sid] = mgr.sessionFile; saveSessionMap(map); }
  return mgr;
}

function resultText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result.content)) {
    return result.content
      .map(c => (c && c.type === "text" && c.text ? c.text : ""))
      .join("\n");
  }
  return "";
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// pi ships 7 tools but only activates 4 by default; Rcode exposes them all,
// gated by the composer mode (mirrors builtin tools.ts gating).
const ALL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const MODE_TOOLS = {
  "full-access": ALL_TOOLS,
  restricted: ["read", "edit", "write", "grep", "find", "ls"],
  plan: ["read", "grep", "find", "ls"],
};

// composer reasoning effort -> pi ThinkingLevel
const EFFORT_TO_THINKING = { minimal: "minimal", low: "low", medium: "medium", high: "high", max: "xhigh" };

function mapEvent(ev, id) {
  if (!ev || typeof ev.type !== "string") return;
  switch (ev.type) {
    case "message_update": {
      const ame = ev.assistantMessageEvent;
      if (!ame) return;
      if (ame.type === "text_delta" && typeof ame.delta === "string") {
        emit({ id, kind: "text", delta: ame.delta });
      } else if (
        (ame.type === "thinking_delta" || ame.type === "reasoning_delta") &&
        typeof ame.delta === "string"
      ) {
        // pi-ai's openai-completions emits thinking_delta for reasoning streams
        emit({ id, kind: "reasoning", delta: ame.delta });
      }
      return;
    }
    case "message_end": {
      const msg = ev.message;
      if (msg && msg.role === "assistant" && msg.usage) {
        emit({ id, kind: "usage", usage: { input: msg.usage.input || 0, output: msg.usage.output || 0 } });
      }
      return;
    }
    case "agent_end": {
      // Terminal error check: per-attempt message_end errors are retried by pi,
      // so only surface an error if the FINAL state of the run is an error.
      const msgs = ev.messages;
      const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : null;
      if (last && last.stopReason === "error" && last.errorMessage) {
        emit({ id, kind: "error", message: String(last.errorMessage) });
      }
      return;
    }
    case "tool_execution_start": {
      emit({ id, kind: "tool_start", toolName: ev.toolName, args: ev.args !== undefined ? JSON.stringify(ev.args) : undefined });
      return;
    }
    case "tool_execution_end": {
      emit({ id, kind: "tool_end", toolName: ev.toolName, result: resultText(ev.result), isError: Boolean(ev.isError) });
      return;
    }
  }
}

async function buildSession(req) {
  const o = req;
  const authStorage = pi.AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(o.provider.id, o.provider.apiKey || "rcode-local");
  const registry = pi.ModelRegistry.inMemory(authStorage);
  const ids = o.modelList && o.modelList.length > 0 ? o.modelList : [o.modelId];
  registry.registerProvider(o.provider.id, {
    name: o.provider.id,
    baseUrl: o.provider.baseUrl,
    apiKey: o.provider.apiKey || "rcode-local",
    api: "openai-completions",
    models: ids.map(id => ({
      id,
      name: id,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    })),
  });
  const model =
    registry.find(o.provider.id, o.modelId) ??
    registry.getAll().find(m => m.provider === o.provider.id);
  if (!model) throw new Error("pi: model not registered: " + o.provider.id + "/" + o.modelId);
  const agentDir = join(o.cwd, ".pi-agent");
  const sessionManager = openOrCreateSessionManager(req.sid, o.cwd);
  // Resume: seed the agent with the persisted transcript (root->leaf branch),
  // otherwise every worker/app restart starts the conversation blank even
  // though the session file exists on disk.
  let resumedMessages = [];
  try {
    resumedMessages = sessionManager
      .getBranch()
      .filter(e => e && e.type === "message" && e.message)
      .map(e => e.message);
  } catch { /* fresh session */ }
  const settingsManager = pi.SettingsManager.inMemory();
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: o.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: o.systemPrompt,
  });
  const agent = new piCore.Agent({
    getApiKey: provider => registry.getApiKeyForProvider(provider),
    ...(resumedMessages.length ? { initialState: { messages: resumedMessages } } : {}),
  });
  const session = new pi.AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: o.cwd,
    resourceLoader,
    modelRegistry: registry,
    model,
  });
  // ctor ignores config.model; the loop reads agent.state.model.
  session.setModel(model);
  return session;
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async line => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  try {
    if (req.op === "ping") {
      emit({ id: req.id, kind: "end" });
      return;
    }
    if (req.op === "drop") {
      sessions.delete(req.sid);
      return;
    }
    if (req.op === "prompt") {
      let entry = sessions.get(req.sid);
      if (!entry) {
        const session = await buildSession(req);
        entry = { session };
        sessions.set(req.sid, entry);
      }
      if (typeof entry.session.setActiveToolsByName === "function") {
        entry.session.setActiveToolsByName(MODE_TOOLS[req.mode] ?? ALL_TOOLS);
      }
      const thinking = EFFORT_TO_THINKING[req.effort];
      if (thinking && typeof entry.session.setThinkingLevel === "function") {
        try { entry.session.setThinkingLevel(thinking); } catch { /* model may not support thinking */ }
      }
      // Per-prompt listener: this request's id is captured in the closure, so a
      // concurrent second prompt can never steal the event routing (a shared
      // mutable currentId silently dropped whole turns before).
      const unsub = entry.session.subscribe(ev => mapEvent(ev, req.id));
      try {
        await entry.session.prompt(req.prompt);
      } catch (e) {
        emit({ id: req.id, kind: "error", message: String((e && e.message) || e) });
      } finally {
        unsub();
      }
      emit({ id: req.id, kind: "end" });
      return;
    }
    if (req.op === "compact") {
      const entry = sessions.get(req.sid);
      if (!entry) {
        emit({ id: req.id, kind: "error", message: "no active pi session for this chat yet" });
        emit({ id: req.id, kind: "end" });
        return;
      }
      try {
        const res = await entry.session.compact();
        emit({ id: req.id, kind: "text", delta: res?.summary ? "Compacted: " + String(res.summary).slice(0, 200) : "Compacted." });
      } catch (e) {
        emit({ id: req.id, kind: "error", message: String((e && e.message) || e) });
      }
      emit({ id: req.id, kind: "end" });
    }
  } catch (e) {
    emit({ id: req && req.id, kind: "error", message: String((e && e.message) || e) });
    emit({ id: req && req.id, kind: "end" });
  }
});

process.stdout.write(JSON.stringify({ kind: "ready" }) + "\n");
