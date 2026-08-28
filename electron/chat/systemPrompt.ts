/*
 * PURPOSE: Build the system prompt from global + per-session custom instructions
 *
 * The base prompt establishes the coding assistant role.
 * Global instructions apply to all sessions.
 * Per-session instructions override/extend for a specific conversation.
 * All three are concatenated with double-newline separators.
 *
 * CONSUMERS: ipc/chat.ts
 */

const BASE_PROMPT = `You are Rcode, a helpful coding assistant. You provide clear, accurate, and concise answers. When showing code, use proper markdown code blocks with language tags.`;

export function buildSystemPrompt(globalInstructions: string, sessionInstructions: string | null): string {
  const parts = [BASE_PROMPT, globalInstructions, sessionInstructions].filter(p => p != null && p.length > 0);
  return parts.join("\n\n");
}
