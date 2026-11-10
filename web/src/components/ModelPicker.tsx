import type { ReactElement } from "react";

/**
 * One model of the provider currently chosen in the picker. The host app fills
 * these from the provider catalogue; the web bundle never imports provider code.
 */
export interface ModelOption {
  id: string;
  name: string;
  /** Context window in tokens. */
  context?: number;
  /** USD per 1M input tokens. */
  inputCost?: number;
  /** USD per 1M output tokens. */
  outputCost?: number;
  toolCall?: boolean;
  deprecated?: boolean;
}

export interface ModelPickerProps {
  models: readonly ModelOption[];
  value: string | null;
  onSelect: (id: string) => void;
  /** Optional client-side filter over name and id. */
  filter?: string;
}

function formatContext(tokens: number | undefined): string {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1_000_000) {
    const millions = Math.round((tokens / 1_000_000) * 10) / 10;
    return `${String(millions).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function formatPrice(input: number | undefined, output: number | undefined): string {
  const hasInput = input !== undefined && Number.isFinite(input);
  const hasOutput = output !== undefined && Number.isFinite(output);
  if (!hasInput && !hasOutput) return "—";
  const left = hasInput ? `$${input.toFixed(2)}` : "—";
  const right = hasOutput ? `$${output.toFixed(2)}` : "—";
  return `${left} / ${right} per 1M`;
}

export function ModelPicker({ models, value, onSelect, filter }: ModelPickerProps): ReactElement {
  const query = (filter ?? "").trim().toLowerCase();
  const visible =
    query.length === 0
      ? models
      : models.filter(
          (model) =>
            model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
        );

  if (visible.length === 0) {
    return (
      <div className="model-picker" aria-label="Models">
        <p className="model-picker__empty">
          {models.length === 0 ? "No models for this provider." : `Nothing matches “${query}”.`}
        </p>
      </div>
    );
  }

  return (
    <div className="model-picker" aria-label="Models">
      {query.length > 0 ? (
        <p className="model-picker__count">
          {visible.length} of {models.length} models
        </p>
      ) : null}
      <ul className="model-picker__list">
        {visible.map((model) => {
          const selected = model.id === value;
          return (
            <li key={model.id} className="model-picker__item">
              <button
                type="button"
                className={
                  selected ? "model-picker__option model-picker__option--active" : "model-picker__option"
                }
                aria-pressed={selected}
                onClick={() => onSelect(model.id)}
              >
                <span className="model-picker__head">
                  <span className="model-picker__name">{model.name}</span>
                  {model.toolCall ? <span className="model-picker__badge">tools</span> : null}
                  {model.deprecated ? (
                    <span className="model-picker__deprecated">deprecated</span>
                  ) : null}
                </span>
                <span className="model-picker__meta">
                  <span className="model-picker__context">{formatContext(model.context)}</span>
                  <span className="model-picker__price">
                    {formatPrice(model.inputCost, model.outputCost)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
