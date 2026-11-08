import { WebSocket } from "ws";
import type { Frame, PeerTransport } from "./types.js";

/**
 * PeerTransport bovenop een `ws`-socket. De socket hoeft nog niet open te zijn;
 * frames die vóór `open` worden verstuurd worden bewaard en daarna verzonden.
 */
export function webSocketTransport(socket: WebSocket, label?: string): PeerTransport {
  let messageHandler: ((raw: string) => void) | undefined;
  let closeHandler: ((reason?: string) => void) | undefined;
  const backlog: string[] = [];
  let open = socket.readyState === WebSocket.OPEN;
  let closed = false;

  socket.on("open", () => {
    open = true;
    while (backlog.length > 0) {
      const raw = backlog.shift();
      if (raw !== undefined) socket.send(raw);
    }
  });

  socket.on("message", (data: unknown) => {
    const raw = typeof data === "string" ? data : String(data);
    messageHandler?.(raw);
  });

  socket.on("close", (code: number) => {
    closed = true;
    open = false;
    closeHandler?.(`socket gesloten (${code})`);
  });

  socket.on("error", (error: Error) => {
    closeHandler?.(error.message);
  });

  return {
    label: label ?? "ws",
    send(frame: Frame): void {
      if (closed) return;
      const raw = JSON.stringify(frame);
      if (!open) {
        backlog.push(raw);
        return;
      }
      socket.send(raw);
    },
    close(reason?: string): void {
      if (closed) return;
      closed = true;
      // 1000 = normale afsluiting, ook bij een conflict: de inhoud blijft staan.
      socket.close(1000, reason ?? "klaar");
    },
    onMessage(handler: (raw: string) => void): void {
      messageHandler = handler;
    },
    onClose(handler: (reason?: string) => void): void {
      closeHandler = handler;
    },
  };
}
