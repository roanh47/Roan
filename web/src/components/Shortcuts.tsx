import { useEffect, useRef } from "react";
import type { MouseEvent, ReactElement } from "react";

export interface ShortcutRow {
  keys: readonly string[];
  description: string;
}

export interface ShortcutsProps {
  open: boolean;
  onClose: () => void;
  /** Overrides the built-in key list. */
  shortcuts?: readonly ShortcutRow[];
}

const DEFAULT_SHORTCUTS: readonly ShortcutRow[] = [
  { keys: ["Enter"], description: "Send message" },
  { keys: ["Shift", "Enter"], description: "Insert newline" },
  { keys: ["Ctrl/Cmd", "N"], description: "Start a new chain" },
  { keys: ["Ctrl/Cmd", ","], description: "Open settings" },
  { keys: ["?"], description: "Show this help" },
  { keys: ["Esc"], description: "Close overlay" },
];

export function Shortcuts({ open, onClose, shortcuts }: ShortcutsProps): ReactElement | null {
  const closeButton = useRef<HTMLButtonElement>(null);
  const rows = shortcuts ?? DEFAULT_SHORTCUTS;

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  function onBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="shortcuts" onClick={onBackdropClick}>
      <div
        className="shortcuts__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="shortcuts__header">
          <h2 className="shortcuts__title" id="shortcuts-title">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeButton}
            className="shortcuts__close"
            type="button"
            aria-label="Close help"
            onClick={onClose}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <dl className="shortcuts__list">
          {rows.map((row): ReactElement => (
            <div className="shortcuts__row" key={`${row.description}:${row.keys.join("+")}`}>
              <dt className="shortcuts__keys">
                {row.keys.map((key): ReactElement => (
                  <kbd className="shortcuts__key" key={key}>
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="shortcuts__desc">{row.description}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcuts__hint">
          Press <kbd className="shortcuts__key">Esc</kbd> to dismiss.
        </p>
      </div>
    </div>
  );
}
