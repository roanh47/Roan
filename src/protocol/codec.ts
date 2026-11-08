/**
 * JSON codec for transport frames.
 *
 * Encoding validates before serialising, decoding parses and then validates,
 * so a caller can never accidentally put a half-formed frame on the wire or
 * accept one. Version checking lives here because it is a wire concern; the
 * structural rules live in `validate.ts`.
 */

import type { TransportFrame } from "./types.js";
import {
  ProtocolError,
  assertNever,
  assertProtocolVersion,
  validateFrame,
} from "./validate.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one version gate. Frames that carry events borrow the event version;
 * `tool_req` and `tool_res` carry no version of their own and are only valid
 * inside a session that already agreed on one.
 */
function assertFrameVersion(frame: TransportFrame): void {
  switch (frame.t) {
    case "hello":
      assertProtocolVersion(frame.v, "frame.v");
      return;
    case "events":
      for (const [index, event] of frame.events.entries()) {
        assertProtocolVersion(event.v, `frame.events[${index}].v`);
      }
      return;
    case "append":
      assertProtocolVersion(frame.event.v, "frame.event.v");
      return;
    case "tool_req":
    case "tool_res":
      return;
    default:
      return assertNever(frame, "frame.t");
  }
}

/**
 * Serialise one frame to a single JSON line (no trailing newline).
 *
 * @throws ProtocolError when the frame is malformed or not JSON-serialisable.
 */
export function encodeFrame(frame: TransportFrame): string {
  const validated = validateFrame(frame);
  assertFrameVersion(validated);

  try {
    return JSON.stringify(validated);
  } catch (error: unknown) {
    throw new ProtocolError(
      "invalid_frame",
      "frame",
      `cannot serialise frame ${validated.t}: ${messageOf(error)}`,
    );
  }
}

/**
 * Parse and validate one frame from JSON text.
 *
 * @throws ProtocolError with code `invalid_json` when the text is not JSON, or
 * with the relevant validation code when it is JSON but not a valid frame.
 */
export function decodeFrame(text: string): TransportFrame {
  if (typeof text !== "string") {
    throw new ProtocolError("invalid_json", "frame", "input must be a JSON string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new ProtocolError(
      "invalid_json",
      "frame",
      `not valid JSON: ${messageOf(error)}`,
    );
  }

  const frame = validateFrame(parsed);
  assertFrameVersion(frame);
  return frame;
}
