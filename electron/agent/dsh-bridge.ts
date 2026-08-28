/*
 * PURPOSE: DeepSeek Harness bridge — park Rcode loop, make DSH core
 *
 * Spawns `dsh --profile headless` as a one-shot agent for each turn.
 * The harness handles the full agent loop (tools, persistence, sandbox)
 * and streams back the final assistant message. Rcode's frontend remains
 * the skin (R logo, 960 composer, Radix, SQLite) but the engine is DSH.
 *
 * Verified: `npx @deepseek-ai/dsh --profile headless "task"` is the headless
 * entry (not --headless flag), and `dsh web` is the Web UI on :3080.
 * Headless is one-shot, not a persistent RPC — for persistent streaming we
 * would use the SDK profile (needs `dsh plugin --profile sdk add` first).
 *
 * For now this bridge wraps the one-shot headless and adapts its output to
 * the existing chat:send SSE shape (chunks + done).
 */

import { spawn } from "child_process";

export interface DshChunk {
  content: string;
  done: boolean;
}

export async function* runDshTask(prompt: string): AsyncGenerator<DshChunk> {
  // Park Rcode loop — delegate to DSH headless
  const child = spawn("npx", ["@deepseek-ai/dsh", "--profile", "headless", prompt], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let buffer = "";
  for await (const chunk of child.stdout) {
    buffer += chunk.toString();
    // Stream as we go — split by lines to simulate chunks
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield { content: line + "\n", done: false };
    }
  }
  if (buffer.trim()) yield { content: buffer, done: false };

  const exitCode: number = await new Promise(res => child.on("close", res as never));
  if (exitCode !== 0) {
    let err = "";
    for await (const chunk of child.stderr) err += chunk.toString();
    throw new Error(`dsh headless failed (${exitCode}): ${err.slice(0, 500)}`);
  }
  yield { content: "", done: true };
}
