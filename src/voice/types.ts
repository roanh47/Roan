import type { SpeechAudio, SttConfig, SttProvider } from "../stt/provider.js";
import type { TtsConfig, TtsProvider } from "./tts.js";

/**
 * The shapes of the conversation loop, kept apart from the machine that runs it
 * so the app can name a state and a reason without importing the loop itself.
 */

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

/** Why a run of the loop ended. Every one of these is a deliberate stop. */
export type VoiceStopReason =
  | "stopped"
  | "no-audio"
  | "empty-transcript"
  | "empty-reply"
  | "stt-failed"
  | "tts-failed"
  | "playback-failed"
  | "turn-failed"
  | "listen-failed"
  | "not-configured"
  | "max-turns";

export interface VoiceLoopEnd {
  readonly reason: VoiceStopReason;
  /** The provider or turn error behind `stt-failed`, `tts-failed`, … */
  readonly error?: Error;
  /** How many full exchanges completed before the loop ended. */
  readonly turns: number;
  /** The last transcript the loop heard, when it got that far. */
  readonly transcript?: string;
}

export interface VoiceLoopOptions {
  /** Turns what `listen()` handed in into text. */
  readonly stt: SttProvider;
  /** Turns the agent's reply into audio bytes. */
  readonly tts: TtsProvider;
  /**
   * Runs one agent turn. Receives the transcript and an abort signal; resolves
   * with the reply to speak. A rejected turn ends the loop with `turn-failed`.
   */
  readonly turn: (transcript: string, signal: AbortSignal) => Promise<string>;
  /**
   * Waits for one utterance and resolves with its bytes, or `null` when there is
   * nothing to hear (silence, the user hung up). Capture is the caller's job.
   */
  readonly listen: (signal: AbortSignal) => Promise<SpeechAudio | null>;
  readonly sttConfig?: SttConfig;
  readonly ttsConfig?: TtsConfig;
  /** Every transition, in order. The last transition of a run is always `idle`. */
  readonly onState?: (state: VoiceState) => void;
  /** The finished clip and the text it reads. Play it; this module will not. */
  readonly onSpeech?: (audio: SpeechAudio, text: string) => void;
  /** Safety valve against a loop nobody stops. Reaching it ends with `max-turns`. */
  readonly maxTurns?: number;
}

export interface VoiceLoop {
  /** Runs until the loop ends. Throws `already running` on a second start. */
  start(): Promise<VoiceLoopEnd>;
  /** Ends the loop at the next boundary. Safe to call twice, or before start. */
  stop(): void;
  readonly state: VoiceState;
  readonly running: boolean;
  readonly turns: number;
  /** How the last run ended, once one has. */
  readonly lastEnd: VoiceLoopEnd | undefined;
}
