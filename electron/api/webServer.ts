/*
 * Local browser bridge.
 *
 * The full renderer can run in a normal browser while the DB, pi worker,
 * providers, PTYs, and file access remain in the local Rcode backend.
 * Bound to localhost only; Vite proxies same-origin /api requests to it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";

import { emitApiEvent, invokeApiHandler, listApiHandlers, onApiEvent } from "./registry";

interface BrowserClient {
  id: string;
  res: ServerResponse;
}

const clients = new Map<string, BrowserClient>();
const PORT = Number(process.env.RCODE_WEB_API_PORT ?? 5174);
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

async function readJson(req: ServerResponse extends never ? never : IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = chunk as Buffer;
    size += value.length;
    if (size > 20 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const channelFilter = url.searchParams.get("channel");
  const id = randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`);
  const client: BrowserClient = { id, res };
  clients.set(id, client);

  const unsubscribe = onApiEvent((channel, args) => {
    if (channelFilter && channel !== channelFilter) return;
    writeSse(res, "ipc", { channel, args });
  });

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    clients.delete(id);
  });
}

async function handleInvoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const channel = decodeURIComponent(url.pathname.replace(/^\/api\/ipc\//, ""));
  if (!channel) throw new Error("Missing API channel");

  const body = await readJson(req);
  const args = Array.isArray(body.args) ? body.args : [];
  const event = {
    sender: {
      isDestroyed: () => false,
      send: (eventChannel: string, ...args: unknown[]) => {
        emitApiEvent(eventChannel, args);
      },
    },
  };

  const result = await invokeApiHandler(channel, args, event);
  writeJson(res, 200, { ok: true, result });
}

export function startWebApiServer(): void {
  if (process.env.RCODE_WEB_API === "off") return;

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalRequest(req) || !isAllowedOrigin(req)) {
        writeJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/health") {
        writeJson(res, 200, { ok: true, handlers: listApiHandlers() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        handleEvents(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/ipc/")) {
        await handleInvoke(req, res);
        return;
      }

      writeJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`[rcode] browser API: http://127.0.0.1:${PORT}/api/health`);
  });

  server.on("error", error => {
    // Don't make Electron unusable when a previous backend already owns the port.
    // eslint-disable-next-line no-console
    console.error("[rcode] browser API failed:", error.message);
  });
}
