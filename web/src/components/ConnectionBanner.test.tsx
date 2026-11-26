/**
 * The daemon banner is chrome, not a conversation: it exists while the socket
 * is down, says why, offers Retry, and vanishes the moment the socket opens.
 * Rendered from props, so the markup is the whole behaviour.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionBanner } from "./ConnectionBanner.js";

function html(status: "idle" | "connecting" | "open" | "reconnecting" | "closed", reason?: string): string {
  return renderToStaticMarkup(
    <ConnectionBanner status={status} reason={reason ?? null} onRetry={() => undefined} />,
  );
}

describe("the daemon banner", () => {
  it("renders nothing at all while the socket is open", () => {
    expect(html("open")).toBe("");
  });

  it("renders nothing on the very first paint either", () => {
    expect(html("idle")).toBe("");
  });

  it("names the wait instead of pretending to be a chat state", () => {
    const markup = html("connecting");
    expect(markup).toContain("the daemon on this device is not answering");
    expect(markup).not.toContain("Message Roan");
  });

  it("says what is wrong and offers the one action when the connection closed", () => {
    const markup = html("closed");
    expect(markup).toContain("Daemon not connected");
    expect(markup).toContain("the daemon closed the connection");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="status"');
  });

  it("carries the client's reason next to the status", () => {
    const markup = html("reconnecting", "the daemon connection reported an error");
    expect(markup).toContain("the daemon on this device is not answering");
    expect(markup).toContain("the daemon connection reported an error");
  });
});
