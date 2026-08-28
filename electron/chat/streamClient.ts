/*
 * PURPOSE: SSE stream parser for OpenAI-compatible chat completions
 *
 * Handles partial JSON across chunk boundaries by buffering incomplete lines.
 * Yields the raw data payload of each "data: " line (excluding [DONE]).
 *
 * CONSUMERS: ipc/chat.ts
 */

interface SSEChunk {
  choices?: Array<{
    delta?: { content?: string };
  }>;
}

// JSON.parse returns any; this is a well-known API response shape — safe cast
export function parseSSEData(data: string): SSEChunk {
  return JSON.parse(data) as SSEChunk;
}

export async function* sseLines(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      yield data;
    }
  }

  if (buffer.startsWith("data: ")) {
    const data = buffer.slice(6);
    if (data !== "[DONE]") yield data;
  }
}
