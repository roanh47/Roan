import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactElement } from "react";

interface ComposerProps {
  /** Locked while a turn is open or the chain is not connected. */
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}

export function Composer({ disabled, placeholder, onSend }: ComposerProps): ReactElement {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [value]);

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

  return (
    <form
      className="composer"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit();
      }}
    >
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
