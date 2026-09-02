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
 *      modelList, cwd, systemPrompt}
 *   → {op:"drop", sid}
 *   ← {id, kind:"text"|"reasoning", delta}
 *   ← {id, kind:"tool_start", toolName, args}
 *   ← {id, kind:"tool_end", toolName, result, isError}
 *   ← {id, kind:"usage", usage:{input,output}}
 *   ← {id, kind:"error", message}
 *   ← {id, kind:"end"}
 */
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PI_PKG = "C:/Users/babys/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent";
const pi = (await import(pathToFileURL(join(PI_PKG, "dist/index.js")).href));
const piCore = (await import(pathToFileURL(join(PI_PKG, "node_modules/@earendil-works/pi-agent-core/dist/index.js")).href));

// sid -> {session, currentId}
const sessions = new Map();

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

function mapEvent(ev, id) {
  if (!ev || typeof ev.type !== "string") return;
  switch (ev.type) {
    case "message_update": {
      const ame = ev.assistantMessageEvent;
      if (!ame) return;
      if (ame.type === "text_delta" && typeof ame.delta === "string") {
        emit({ id, kind: "text", delta: ame.delta });
      } else if (ame.type === "reasoning_delta" && typeof ame.delta === "string") {
        emit({ id, kind: "reasoning", delta: ame.delta });
      }
      return;
    }
    case "message_end": {
      const msg = ev.message;
      if (msg && msg.stopReason === "error" && msg.errorMessage) {
        emit({ id, kind: "error", message: String(msg.errorMessage) });
        return;
      }
      if (msg && msg.role === "assistant" && msg.usage) {
        emit({ id, kind: "usage", usage: { input: msg.usage.input || 0, output: msg.usage.output || 0 } });
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
  const sessionManager = pi.SessionManager.inMemory(o.cwd);
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
        entry = { session, currentId: null };
        // Subscribe exactly once per session; currentId routes events to the
        // in-flight request (re-subscribing per prompt would duplicate chunks).
        entry.session.subscribe(ev => mapEvent(ev, entry.currentId));
        sessions.set(req.sid, entry);
      }
      entry.currentId = req.id;
      try {
        await entry.session.prompt(req.prompt);
      } catch (e) {
        emit({ id: req.id, kind: "error", message: String((e && e.message) || e) });
      }
      entry.currentId = null;
      emit({ id: req.id, kind: "end" });
    }
  } catch (e) {
    emit({ id: req && req.id, kind: "error", message: String((e && e.message) || e) });
    emit({ id: req && req.id, kind: "end" });
  }
});

process.stdout.write(JSON.stringify({ kind: "ready" }) + "\n");
