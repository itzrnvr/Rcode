/*
 * PURPOSE: Model settings — mirrors Z screenshot + DSH wandb models
 *
 * Two-pane layout:
 *   Left: Providers list (Z.ai + Custom providers) with enabled dot
 *   Right: Selected provider editor (Base URL, API format, API key, Model list)
 *
 * All providers' model lists are flattened into the composer pill via useProviders.
 * Real DSH wandb models (29) are seeded in DB; user can Add provider/model.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { EyeIcon, EyeOffIcon, TrashIcon, EditIcon, PlusIcon, CheckIcon } from "../common/Icons";

interface ProviderModel {
  id: string;
  vision?: number;
  context?: string;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  modelList: ProviderModel[];
  enabled: number;
  isCustom: number;
  createdAt: number;
}

export function ModelSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editModelId, setEditModelId] = useState("");

  const load = useCallback(async () => {
    const list = await (api as unknown as { listProviders: () => Promise<Provider[]> }).listProviders();
    setProviders(list);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = providers.find(p => p.id === selectedId) || null;

  const updateSelected = async (updates: Partial<Provider>) => {
    if (!selected) return;
    await (api as unknown as { updateProvider: (id: string, u: Partial<Provider>) => Promise<void> }).updateProvider(selected.id, updates);
    await load();
  };

  const toggleEnabled = async () => {
    if (!selected) return;
    await (api as unknown as { toggleProvider: (id: string) => Promise<number> }).toggleProvider(selected.id);
    await load();
  };

  const addProvider = async () => {
    const name = `custom-${Date.now().toString(36)}`;
    await (api as unknown as { createProvider: (p: Partial<Provider> & { name: string }) => Promise<Provider> }).createProvider({
      name,
      baseUrl: "https://api.example.com/v1",
      apiFormat: "openai-completions",
      apiKey: "",
      modelList: [],
      enabled: 1,
      isCustom: 1,
    });
    await load();
    setSelectedId(name);
  };

  const deleteProvider = async () => {
    if (!selected || !confirm(`Delete provider "${selected.name}"?`)) return;
    await (api as unknown as { deleteProvider: (id: string) => Promise<void> }).deleteProvider(selected.id);
    setSelectedId(null);
    await load();
  };

  const addModel = async () => {
    if (!selected || !newModelId.trim()) return;
    const list = [...selected.modelList, { id: newModelId.trim(), vision: 0, context: "128K" }];
    await updateSelected({ modelList: list });
    setNewModelId("");
  };

  const removeModel = async (mid: string) => {
    if (!selected) return;
    const list = selected.modelList.filter(m => m.id !== mid);
    await updateSelected({ modelList: list });
  };

  const startEditModel = (mid: string) => {
    setEditingModel(mid);
    setEditModelId(mid);
  };

  const saveEditModel = async () => {
    if (!selected || !editingModel || !editModelId.trim()) return;
    const list = selected.modelList.map(m => m.id === editingModel ? { ...m, id: editModelId.trim() } : m);
    await updateSelected({ modelList: list });
    setEditingModel(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      <div style={{ padding: "24px 32px 16px", borderBottom: "1px solid #1f1f1f" }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: -0.02 * 28 }}>Model settings</h2>
        <p style={{ fontSize: 13, color: "#8a8a8a", margin: "8px 0 0" }}>Manage custom model providers. Once configured, they can be selected during chat.</p>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}>
        {/* Left: Providers list */}
        <div style={{ width: 260, borderRight: "1px solid #1f1f1f", background: "#0f0f0f", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "8px 8px 6px" }}>Providers</div>
            {providers.filter(p => !p.isCustom).map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 8,
                  border: "1px solid transparent",
                  background: selectedId === p.id ? "#1a1a1a" : "transparent",
                  color: "#e8e8e8",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 6, background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>Z</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: p.enabled ? "#22c55e" : "#52525b" }} />
              </button>
            ))}

            <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "16px 8px 6px" }}>Custom providers</div>
            {providers.filter(p => p.isCustom).map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 8,
                  border: selectedId === p.id ? "1px solid #262626" : "1px solid transparent",
                  background: selectedId === p.id ? "#1a1a1a" : "transparent",
                  color: "#e8e8e8",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 4, border: "1px solid #262626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>⬢</span>
                <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: p.enabled ? "#22c55e" : "#52525b" }} />
              </button>
            ))}

            <button
              onClick={addProvider}
              style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 8, border: "1px dashed #262626", background: "transparent", color: "#8a8a8a", cursor: "pointer", fontSize: 13 }}
            >
              <PlusIcon size={14} /> Add provider
            </button>
          </div>
        </div>

        {/* Right: Editor */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", background: "#0a0a0a" }}>
          {!selected ? (
            <div style={{ color: "#8a8a8a", textAlign: "center", marginTop: 80 }}>Select a provider to edit</div>
          ) : (
            <div style={{ maxWidth: 640 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{selected.name}</span>
                <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, background: "#1a1a1a", border: "1px solid #262626", color: "#8a8a8a" }}><EditIcon size={10} /> </span>
                <span style={{ padding: "3px 10px", borderRadius: 999, background: selected.enabled ? "#22c55e" : "#27272a", color: selected.enabled ? "#052e16" : "#e4e4e7", fontSize: 12, fontWeight: 600 }}>{selected.enabled ? "Enabled" : "Disabled"}</span>
                <button onClick={toggleEnabled} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #262626", background: "#1a1a1a", color: "#e8e8e8", fontSize: 12, cursor: "pointer" }}>{selected.enabled ? "Disable" : "Enable"}</button>
                <button onClick={deleteProvider} style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "#8a8a8a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Delete provider"><TrashIcon size={14} /></button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e8e8e8", marginBottom: 6 }}>Base URL</div>
                  <input
                    value={selected.baseUrl}
                    onChange={e => updateSelected({ baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #262626", background: "#1a1a1a", color: "#e8e8e8", fontSize: 13, outline: "none" }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e8e8e8", marginBottom: 6 }}>API format</div>
                  <select
                    value={selected.apiFormat}
                    onChange={e => updateSelected({ apiFormat: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #262626", background: "#1a1a1a", color: "#e8e8e8", fontSize: 13, outline: "none" }}
                  >
                    <option value="openai-completions">Chat Completions (/chat/completions)</option>
                    <option value="responses">Responses (/responses)</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e8e8e8", marginBottom: 6 }}>API key</div>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type={showKey ? "text" : "password"}
                      value={selected.apiKey}
                      onChange={e => updateSelected({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      style={{ width: "100%", padding: "10px 36px 10px 12px", borderRadius: 8, border: "1px solid #262626", background: "#1a1a1a", color: "#e8e8e8", fontSize: 13, outline: "none", fontFamily: "monospace" }}
                    />
                    <button onClick={() => setShowKey(v => !v)} style={{ position: "absolute", right: 8, width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "#8a8a8a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {showKey ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e8e8e8", marginBottom: 10 }}>Model list</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {selected.modelList.map(m => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #262626", background: "#1a1a1a" }}>
                        {editingModel === m.id ? (
                          <>
                            <input
                              value={editModelId}
                              onChange={e => setEditModelId(e.target.value)}
                              style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #3f3f46", background: "#0a0a0a", color: "#fff", fontSize: 13 }}
                              autoFocus
                            />
                            <button onClick={saveEditModel} style={{ padding: "6px 10px", borderRadius: 6, background: "#22c55e", color: "#052e16", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><CheckIcon size={12} /> Save</button>
                            <button onClick={() => setEditingModel(null)} style={{ padding: "6px 10px", borderRadius: 6, background: "#27272a", color: "#e4e4e7", border: "none", cursor: "pointer" }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <span style={{ flex: 1, fontSize: 13, color: "#e8e8e8", fontFamily: "monospace" }}>{m.id}</span>
                            {m.vision ? <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af" }}>Vision</span> : null}
                            {m.context ? <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 999, background: "#1a1a1a", border: "1px solid #262626", color: "#8a8a8a" }}>{m.context}</span> : null}
                            <button onClick={() => startEditModel(m.id)} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "#8a8a8a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><EditIcon size={12} /></button>
                            <button onClick={() => removeModel(m.id)} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><TrashIcon size={12} /></button>
                          </>
                        )}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <input
                        value={newModelId}
                        onChange={e => setNewModelId(e.target.value)}
                        placeholder="model-id (e.g. my-model-7b)"
                        onKeyDown={e => e.key === "Enter" && addModel()}
                        style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #262626", background: "#0f0f0f", color: "#e8e8e8", fontSize: 13, outline: "none" }}
                      />
                      <button onClick={addModel} style={{ padding: "0 16px", borderRadius: 8, border: "1px solid #262626", background: "#1a1a1a", color: "#e8e8e8", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><PlusIcon size={14} /> Add model</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
