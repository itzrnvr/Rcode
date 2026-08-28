export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  description: string;
}

export const MODELS: ModelEntry[] = [
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "Strong multilingual, fast, 128K context",
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "Previous gen, stable",
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "1T MoE, strong reasoning + coding",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "Sparse MoE, fast inference, code-focused",
  },
  {
    id: "qwen3.6-27b-mtp",
    name: "Qwen3.6-27B-MTP",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "Alibaba Qwen3.6 with speculative MTP",
  },
  {
    id: "minimax-h3",
    name: "MiniMax-H3",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "H3 hybrid SSM+attention, fast long-context",
  },
  {
    id: "muse-glimmer-30b",
    name: "Muse-Glimmer-30B",
    provider: "rcode",
    providerLabel: "RCODE",
    description: "Creative writing + roleplay tuned",
  },
];
