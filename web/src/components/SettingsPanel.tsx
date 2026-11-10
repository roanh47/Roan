import { useEffect, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

interface SettingsDraft {
  provider: string;
  model: string;
  workspace: string;
}

interface SettingsPanelProps {
  provider: string;
  model: string;
  /** Absolute path of the directory the daemon works in. */
  workspace: string;
  saving?: boolean;
  error?: string | null;
  onChange: (patch: { provider?: string; model?: string; workspace?: string }) => void;
}

/**
 * Accepts POSIX ("/srv/roan"), home ("~/roan"), Windows drive ("C:\\roan")
 * and UNC ("\\\\host\\share") shapes. Anything else is relative and useless to us.
 */
function validateWorkspace(value: string): string | null {
  const path = value.trim();
  if (path.length === 0) return "Workspace path cannot be empty.";
  if (/^~($|[\\/])/.test(path)) return null;
  if (/^[\\/]/.test(path)) return null;
  if (/^[A-Za-z]:[\\/]/.test(path)) return null;
  return "Enter an absolute path, e.g. /home/roan/Roan.";
}

function isDirty(draft: SettingsDraft, saved: SettingsDraft): boolean {
  return (
    draft.provider !== saved.provider ||
    draft.model !== saved.model ||
    draft.workspace !== saved.workspace
  );
}

interface SettingsField {
  field: keyof SettingsDraft;
  label: string;
  path?: boolean;
}

const FIELDS: readonly SettingsField[] = [
  { field: "provider", label: "Provider" },
  { field: "model", label: "Model" },
  { field: "workspace", label: "Workspace", path: true },
];

export function SettingsPanel({
  provider,
  model,
  workspace,
  saving = false,
  error = null,
  onChange,
}: SettingsPanelProps): ReactElement {
  const [draft, setDraft] = useState<SettingsDraft>({ provider, model, workspace });

  useEffect(() => {
    setDraft({ provider, model, workspace });
  }, [provider, model, workspace]);

  const saved: SettingsDraft = { provider, model, workspace };
  const dirty = isDirty(draft, saved);
  const pathIssue = validateWorkspace(draft.workspace);
  const blocked = saving || pathIssue !== null || draft.provider.trim().length === 0;
  const canSave = dirty && !blocked;

  function edit(field: keyof SettingsDraft, event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function save(): void {
    if (!canSave) return;
    onChange({
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      workspace: draft.workspace.trim(),
    });
  }

  function reset(): void {
    setDraft({ provider, model, workspace });
  }

  return (
    <section className="settings" aria-label="Provider and workspace">
      <h2 className="settings__title">Model</h2>

      {FIELDS.map(({ field, label, path }) => (
        <div className="settings__field" key={field}>
          <label className="settings__label" htmlFor={`settings-${field}`}>
            {label}
          </label>
          <input
            id={`settings-${field}`}
            className={path ? "settings__input settings__input--path" : "settings__input"}
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={draft[field]}
            disabled={saving}
            aria-invalid={path ? pathIssue !== null : undefined}
            aria-describedby={path && pathIssue !== null ? "settings-workspace-hint" : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => edit(field, event)}
          />
          {path ? (
            <p className="settings__hint" id="settings-workspace-hint">
              {pathIssue ?? "The daemon reads, writes and runs tools inside this directory."}
            </p>
          ) : null}
        </div>
      ))}

      {error ? (
        <p className="settings__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings__actions">
        <button
          className="settings__save"
          type="button"
          disabled={!canSave}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="settings__reset"
          type="button"
          disabled={!dirty || saving}
          onClick={reset}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
