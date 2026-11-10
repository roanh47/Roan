import { useId, useMemo, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";

export interface ProviderOption {
  id: string;
  label: string;
  /** Shown next to the label when the provider advertises a model list. */
  modelCount?: number;
}

export interface ProviderPickerProps {
  providers: readonly ProviderOption[];
  value: string | null;
  onSelect: (id: string) => void;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "model" : "models"}`;
}

export function ProviderPicker({ providers, value, onSelect }: ProviderPickerProps): ReactElement {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;

  // Case-insensitive over id and label, always ordered by label so the order
  // does not depend on how the caller built the array.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept =
      needle.length === 0
        ? providers.slice()
        : providers.filter(
            (option) =>
              option.id.toLowerCase().includes(needle) ||
              option.label.toLowerCase().includes(needle),
          );
    return kept.sort((a, b) => a.label.localeCompare(b.label));
  }, [providers, query]);

  const highlighted = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (matches.length === 0) return;
      setActive((current) => Math.min(current + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const choice = matches[highlighted];
      if (!choice) return;
      event.preventDefault();
      onSelect(choice.id);
    }
  }

  return (
    <section className="provider-picker" aria-label="Providers">
      <label className="sr-only" htmlFor={`${baseId}-search`}>
        Search providers
      </label>
      <input
        id={`${baseId}-search`}
        className="provider-picker__search"
        type="search"
        role="combobox"
        aria-label="Search providers"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlighted >= 0 ? `${baseId}-option-${highlighted}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search providers…"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />

      {matches.length === 0 ? (
        <p className="provider-picker__empty" role="status">
          No matches
        </p>
      ) : (
        <ul className="provider-picker__list" id={listId} role="listbox" aria-label="Providers">
          {matches.map((option, index) => {
            const selected = option.id === value;
            const current = index === highlighted;
            return (
              <li
                key={option.id}
                id={`${baseId}-option-${index}`}
                className={`provider-picker__item${current ? " provider-picker__item--active" : ""}${
                  selected ? " provider-picker__item--selected" : ""
                }`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => onSelect(option.id)}
              >
                <span className="provider-picker__label">{option.label}</span>
                {option.modelCount === undefined ? null : (
                  <span className="provider-picker__meta">{countLabel(option.modelCount)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
