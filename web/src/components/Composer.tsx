import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactElement } from "react";
import type { ChainClient } from "../chain.js";

interface WorkspaceFile {
  path: string;
  bytes: number;
}

interface ComposerProps {
  /** Locked while a turn is open or the chain is not connected. */
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  /** Called when a workspace file was picked, so the app returns to chat. */
  onPickFile?: () => void;
  /** With a client the plus menu lists the workspace; without it stays lean. */
  client?: ChainClient;
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

export function Composer({ disabled, placeholder, onSend, onPickFile, client }: ComposerProps): ReactElement {
  // Without a workspace and without dictation there is nothing behind the
  // plus, so the button does not exist.
  const hasMenu = client !== undefined || DICTATION !== null;
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [listening, setListening] = useState(false);
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

  const ready = value.trim().length > 0 && !disabled;

  function submit(): void {
    const text = value.trim();
    if (text.length === 0 || disabled) return;
    onSend(text);
    setValue("");
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
        </div>
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
        aria-label="Send message"
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
