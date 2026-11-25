import { WebSocket } from "ws";
import type { Frame, PeerTransport } from "./types.js";

/**
 * PeerTransport on top of a `ws` socket. The socket need not be open yet;
 * frames sent before `open` are buffered and transmitted afterwards.
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
    closeHandler?.(`socket closed (${code})`);
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
      // 1000 = normal closure, also on a conflict: the content stays intact.
      socket.close(1000, reason ?? "done");
    },
    onMessage(handler: (raw: string) => void): void {
      messageHandler = handler;
    },
    onClose(handler: (reason?: string) => void): void {
      closeHandler = handler;
    },
  };
}
