import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent, ReactElement } from "react";
import type { ChainClient } from "../chain.js";

interface WorkspaceFile {
  path: string;
  bytes: number;
}

export interface AttachedImage {
  /** Mime type, image/jpeg after the downscale. */
  mime: string;
  /** Base64, no data-url prefix. */
  data: string;
}

/** The sentence the composer shows while the conversation may not act. */
export const PLAN_MODE_HINT =
  "read-only — Roan researches and writes a plan. It cannot write files or run commands until you approve it.";

const PLAN_PILL: CSSProperties = {
  flex: "none",
  alignSelf: "center",
  padding: "5px 10px",
  border: "1px solid var(--line-soft)",
  borderRadius: 999,
  background: "transparent",
  color: "var(--faint)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.02em",
  cursor: "pointer",
};

const PLAN_PILL_ON: CSSProperties = {
  ...PLAN_PILL,
  borderColor: "rgba(126, 226, 184, 0.45)",
  background: "rgba(126, 226, 184, 0.14)",
  color: "var(--accent)",
};

interface ComposerProps {
  /** Locked while a turn is open or the chain is not connected. */
  disabled: boolean;
  placeholder: string;
  onSend: (text: string, image?: AttachedImage) => void;
  /** Text handed over by the Android share sheet; the stamp makes it fresh. */
  prefill?: { text: string; at: number } | null;
  /** Called when a workspace file was picked, so the app returns to chat. */
  onPickFile?: () => void;
  /** With a client the plus menu lists the workspace; without it stays lean. */
  client?: ChainClient;
  /** The conversation's plan mode, folded from its `plan_mode` events. */
  planMode?: boolean;
  /**
   * Turns plan mode on, or approves the plan by passing `false`. Without it the
   * pill still shows the state but cannot be pressed.
   */
  onPlanModeChange?: (enabled: boolean) => void;
}

// The WebView on Android does not reliably ship SpeechRecognition; the mic
// button only exists where the feature does, so the UI never shows a control
// that cannot work.
interface DictationEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Dictation {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: DictationEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type DictationCtor = new () => Dictation;

function dictationCtor(): DictationCtor | null {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: DictationCtor;
    webkitSpeechRecognition?: DictationCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const DICTATION = dictationCtor();

export function Composer({ disabled, placeholder, onSend, onPickFile, prefill, client, planMode = false, onPlanModeChange }: ComposerProps): ReactElement {
  // The plus always exists: a photo needs neither workspace nor dictation.
  const hasMenu = true;
  const planning = planMode === true;
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [listening, setListening] = useState(false);
  const [image, setImage] = useState<AttachedImage | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const recognition = useRef<Dictation | null>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      recognition.current?.stop();
      recognition.current = null;
    };
  }, []);

  // A share-sheet hand-over fills the box once, stamp by stamp.
  useEffect(() => {
    if (prefill !== null && prefill !== undefined && prefill.text.trim().length > 0) {
      setValue(prefill.text);
    }
  }, [prefill?.at]);

  const ready = (value.trim().length > 0 || image !== null) && !disabled;

  function submit(): void {
    const text = value.trim();
    if (disabled || (text.length === 0 && image === null)) return;
    onSend(text.length > 0 ? text : "[afbeelding]", image ?? undefined);
    setValue("");
    setImage(null);
  }

  /**
   * The toggle is the whole control: on starts a read-only plan turn, off
   * approves the plan. The event that records it belongs to the app, not here —
   * this component only says which way the user flipped it.
   */
  function setPlan(next: boolean): void {
    if (disabled || onPlanModeChange === undefined) return;
    setMenuOpen(false);
    onPlanModeChange(next);
  }

  /** Downscale before it ever leaves the phone: a photo is readable at 1024px. */
  function attachPhoto(event: ChangeEvent<HTMLInputElement>): void {
    setMenuOpen(false);
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    void (async () => {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setImage({ mime: "image/jpeg", data });
      input.current?.focus();
    })().catch(() => {
      /* not decodable: silently no attachment */
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  /** An attachment is a reference into the synced workspace, not an upload. */
  async function openFiles(): Promise<void> {
    if (client === undefined || files !== null) return;
    const answer = await client.request<{ files?: WorkspaceFile[]; error?: string }>("workspace_list");
    setFiles(answer.files ?? []);
  }

  function pickFile(path: string): void {
    setValue((current) => (current.trim().length === 0 ? `@${path} ` : `${current.trimEnd()} @${path} `));
    setMenuOpen(false);
    onPickFile?.();
    input.current?.focus();
  }

  function toggleDictation(): void {
    if (DICTATION === null) return;
    setMenuOpen(false);
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const engine = new DICTATION();
    engine.continuous = false;
    engine.interimResults = true;
    engine.lang = navigator.language;
    engine.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result === undefined) continue;
        const first = result[0];
        if (first !== undefined) text += first.transcript;
      }
      if (text.length > 0) setValue((current) => `${current}${current.length > 0 ? " " : ""}${text.trim()}`);
    };
    engine.onerror = () => setListening(false);
    engine.onend = () => setListening(false);
    recognition.current = engine;
    engine.start();
    setListening(true);
  }

  return (
    <form
      className="composer"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit();
      }}
    >
      {planning && !menuOpen ? (
        <div
          className="composer__planhint"
          role="status"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "calc(100% + 8px)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px 8px 12px",
            border: "1px solid var(--line-soft)",
            borderRadius: 16,
            background: "#12151a",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            fontSize: 12.5,
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1 }}>
            <strong>Plan mode</strong> · {PLAN_MODE_HINT}
          </span>
          <button
            type="button"
            style={{
              flex: "none",
              padding: "6px 12px",
              border: "1px solid rgba(126, 226, 184, 0.45)",
              borderRadius: 999,
              background: "rgba(126, 226, 184, 0.14)",
              color: "var(--accent)",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
            disabled={disabled || onPlanModeChange === undefined}
            onClick={() => setPlan(false)}
          >
            Approve plan
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={planning ? "composer__plan composer__plan--on" : "composer__plan"}
        style={planning ? PLAN_PILL_ON : PLAN_PILL}
        aria-pressed={planning}
        aria-label={
          planning ? "Plan mode is on: read-only. Turn it off" : "Plan mode is off: the agent may write and run commands"
        }
        title="Plan mode: read-only research, nothing is executed until you approve"
        disabled={disabled || onPlanModeChange === undefined}
        onClick={() => setPlan(!planning)}
      >
        Plan
      </button>

      {hasMenu ? (
        <button
          type="button"
          className={menuOpen ? "composer__plus composer__plus--open" : "composer__plus"}
          aria-label="Add to the message"
          aria-expanded={menuOpen}
          disabled={disabled}
          onClick={() => {
            setMenuOpen((open) => !open);
            if (!menuOpen) void openFiles();
          }}
        >
          ＋
        </button>
      ) : null}

      {menuOpen ? (
        <div className="composer__menu" role="menu">
          {client !== undefined && files !== null ? (
            <div className="composer__files">
              <span className="composer__menulabel">Workspace files</span>
              {files.length === 0 ? (
                <span className="composer__menuempty">No files yet — save one in Settings → Workspace.</span>
              ) : (
                files.slice(0, 8).map((file) => (
                  <button key={file.path} type="button" className="composer__menuitem" onClick={() => pickFile(file.path)}>
                    <span className="composer__menupath">{file.path}</span>
                    <span className="composer__menusize">{String(Math.max(1, Math.round(file.bytes / 1024)))} kB</span>
                  </button>
                ))
              )}
            </div>
          ) : client !== undefined ? (
            <span className="composer__menuempty">Loading files…</span>
          ) : null}
          {DICTATION !== null ? (
            <button type="button" className="composer__menuitem" onClick={toggleDictation}>
              <span className="composer__menupath">{listening ? "Stop dictation" : "Dictate"}</span>
            </button>
          ) : null}
          <button type="button" className="composer__menuitem" onClick={() => photoInput.current?.click()}>
            <span className="composer__menupath">Photo</span>
          </button>
        </div>
      ) : null}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Pick a photo"
        onChange={attachPhoto}
      />

      {image !== null ? (
        <span className="composer__photo" aria-label="Photo attached">
          <img src={`data:${image.mime};base64,${image.data}`} alt="" />
          <button type="button" aria-label="Remove photo" onClick={() => setImage(null)}>
            ×
          </button>
        </span>
      ) : null}
      <label className="sr-only" htmlFor="composer-input">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={input}
        className="composer__input"
        rows={1}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby="turn-status"
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="on"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {DICTATION !== null ? (
        <button
          type="button"
          className={listening ? "composer__mic composer__mic--on" : "composer__mic"}
          aria-label={listening ? "Stop dictation" : "Dictate"}
          disabled={disabled}
          onClick={toggleDictation}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
            <path
              d="M8 1.5a2 2 0 0 1 2 2v4a2 2 0 1 1-4 0v-4a2 2 0 0 1 2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v3M6 14h4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
      <button
        className="composer__send"
        type="submit"
        disabled={!ready}
        aria-label={planning ? "Send message (plan mode is read-only)" : "Send message"}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            d="M8 13V3M8 3 3.5 7.5M8 3l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </form>
  );
}
