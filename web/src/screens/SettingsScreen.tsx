import { useEffect, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactElement } from "react";
import { ModelPicker } from "../components/ModelPicker";
import type { ModelOption } from "../components/ModelPicker";
import { ProviderPicker } from "../components/ProviderPicker";
import { defaultLocale, t } from "../i18n";
import type { Locale } from "../i18n";
import { colors, fonts, radii, space } from "../theme";

/** One provider plus the catalogue the daemon reported for it. */
export interface SettingsProvider {
  id: string;
  label: string;
  models: readonly ModelOption[];
}

export interface SettingsValue {
  provider: string;
  model: string;
  /** Absolute path of the directory the daemon works in. */
  workspace: string;
}

export interface SettingsScreenProps {
  providers: readonly SettingsProvider[];
  value: SettingsValue;
  locale?: Locale;
  saving?: boolean;
  error?: string | null;
  /** Called once with the whole draft; the host persists it and updates `value`. */
  onSave: (next: SettingsValue) => void;
}

function validateWorkspace(raw: string): string | null {
  const path = raw.trim();
  if (path.length === 0) return "Workspace path cannot be empty.";
  if (/^~($|[\\/])/.test(path)) return null;
  if (/^[\\/]/.test(path)) return null;
  if (/^[A-Za-z]:[\\/]/.test(path)) return null;
  return "Enter an absolute path, e.g. /home/roan/Roan.";
}

function isDirty(draft: SettingsValue, saved: SettingsValue): boolean {
  return (
    draft.provider !== saved.provider ||
    draft.model !== saved.model ||
    draft.workspace !== saved.workspace
  );
}

const shell: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.xl, padding: space.xl,
  color: colors.fg, background: colors.bg, fontFamily: fonts.sans,
};
const pane: CSSProperties = {
  minWidth: 0, padding: space.md, border: `1px solid ${colors.line}`,
  borderRadius: radii.md, background: colors.surface,
};
const heading: CSSProperties = {
  margin: `0 0 ${space.sm}px`, fontSize: 12, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: colors.faint,
};
const scroll: CSSProperties = { maxHeight: 360, overflowY: "auto", marginTop: space.sm };
const input: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px",
  border: `1px solid ${colors.line}`, borderRadius: radii.sm,
  background: colors.surface2, color: colors.fg, fontFamily: fonts.mono, fontSize: 13,
};
const hint: CSSProperties = { margin: `${space.xs}px 0 0`, fontSize: 12, color: colors.faint };
const grid: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: space.md,
};
const save: CSSProperties = {
  alignSelf: "flex-start", padding: "8px 18px", border: "none", borderRadius: radii.sm,
  background: colors.accent, color: colors.accentInk, fontSize: 13, fontWeight: 600,
};

export function SettingsScreen({
  providers,
  value,
  locale = defaultLocale,
  saving = false,
  error = null,
  onSave,
}: SettingsScreenProps): ReactElement {
  const [draft, setDraft] = useState<SettingsValue>(value);

  useEffect(() => {
    setDraft(value);
  }, [value.provider, value.model, value.workspace]);

  // One array in, both pickers fed: the host never joins catalogues in the UI.
  const options = providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    modelCount: provider.models.length,
  }));
  const models = providers.find((provider) => provider.id === draft.provider)?.models ?? [];
  const pathIssue = validateWorkspace(draft.workspace);
  const canSave =
    isDirty(draft, value) &&
    !saving &&
    pathIssue === null &&
    draft.provider.trim().length > 0 &&
    draft.model.trim().length > 0;

  function chooseProvider(id: string): void {
    setDraft((current) => current.provider === id ? current : { ...current, provider: id, model: "" });
  }

  function submit(): void {
    if (!canSave) return;
    onSave({
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      workspace: draft.workspace.trim(),
    });
  }

  return (
    <form
      className="settings-screen"
      aria-label={t(locale, "settings.heading")}
      style={shell}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650 }}>{t(locale, "settings.heading")}</h1>

      <div style={grid}>
        <section style={pane}>
          <h2 style={heading}>{t(locale, "settings.provider")}</h2>
          {options.length === 0 ? (
            <p style={hint}>No providers available.</p>
          ) : (
            <div style={scroll}>
              <ProviderPicker providers={options} value={draft.provider} onSelect={chooseProvider} />
            </div>
          )}
        </section>

        <section style={pane}>
          <h2 style={heading}>{t(locale, "settings.model")}</h2>
          <p style={{ ...hint, marginTop: 0 }}>
            {draft.model || "Context window and price per 1M tokens"}
          </p>
          <div style={scroll}>
            <ModelPicker
              models={models}
              value={draft.model || null}
              onSelect={(id) => setDraft((current) => ({ ...current, model: id }))}
            />
          </div>
        </section>
      </div>

      <section>
        <h2 style={heading}>{t(locale, "settings.workspace")}</h2>
        <input
          style={input}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={draft.workspace}
          disabled={saving}
          aria-invalid={pathIssue !== null}
          aria-describedby="settings-screen-workspace-hint"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setDraft((current) => ({ ...current, workspace: event.target.value }))
          }
        />
        <p style={hint} id="settings-screen-workspace-hint">
          {pathIssue ?? "The daemon reads, writes and runs tools inside this directory."}
        </p>
      </section>

      {error ? (
        <p role="alert" style={{ ...hint, color: colors.danger }}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSave}
        style={{ ...save, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "default" }}
      >
        {saving ? "Saving…" : t(locale, "settings.save")}
      </button>
    </form>
  );
}
