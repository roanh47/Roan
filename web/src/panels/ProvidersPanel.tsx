import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

interface Preset {
  id: string;
  label: string;
  baseUrl: string;
  keyHint: string;
}

interface Account {
  id: string;
  label: string;
  baseUrl: string;
  keySet: boolean;
  preset: string | null;
}

interface LiveModel {
  id: string;
  name: string;
}

interface Props {
  client: ChainClient;
  current: string;
}

interface ListAnswer {
  presets?: Preset[];
  accounts?: Account[];
  active?: string | null;
}

/**
 * Providers, not URLs.
 *
 * You pick a provider and paste its key; the base URL comes with it. Anything
 * that is not on the list is added by hand (name, URL, key) and can be added
 * more than once. The models come from the provider's own `/models`, because a
 * catalogue cannot know what your key is allowed to call.
 */
export function ProvidersPanel({ client, current }: Props): ReactElement {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [models, setModels] = useState<LiveModel[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [custom, setCustom] = useState({ label: "", baseUrl: "", apiKey: "" });
  const [adding, setAdding] = useState(false);

  async function refresh(): Promise<void> {
    const answer = await client.request<ListAnswer>("providers_list");
    setPresets(answer.presets ?? []);
    setAccounts(answer.accounts ?? []);
    setActive(answer.active ?? null);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadModels(id: string): Promise<void> {
    setBusy(true);
    setOpenId(id);
    setModels([]);
    const answer = await client.request<{ models?: LiveModel[]; error?: string }>("models_list", { id });
    setBusy(false);
    if (answer.error !== undefined) setStatus(`${answer.error} — pick a model by hand below`);
    else setStatus(null);
    setModels(answer.models ?? []);
  }

  async function pick(id: string, model?: string): Promise<void> {
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string; model?: string }>("provider_pick", {
      id,
      ...(model !== undefined ? { model } : {}),
    });
    setBusy(false);
    setStatus(answer.error ?? `using ${accounts.find((item) => item.id === id)?.label ?? id}`);
    await refresh();
  }

  async function addPreset(preset: Preset): Promise<void> {
    if (keyDraft.trim().length === 0) {
      setStatus(`paste the ${preset.label} key first`);
      setOpenId(`key:${preset.id}`);
      return;
    }
    setBusy(true);
    const saved = await client.request<{ id?: string; error?: string }>("provider_save", {
      label: preset.label,
      baseUrl: preset.baseUrl,
      apiKey: keyDraft.trim(),
      preset: preset.id,
    });
    setBusy(false);
    setKeyDraft("");
    if (saved.error !== undefined || saved.id === undefined) {
      setStatus(saved.error ?? "could not save that provider");
      return;
    }
    await pick(saved.id);
    await loadModels(saved.id);
  }

  async function addCustom(): Promise<void> {
    setBusy(true);
    const saved = await client.request<{ id?: string; error?: string }>("provider_save", {
      label: custom.label.trim(),
      baseUrl: custom.baseUrl.trim(),
      apiKey: custom.apiKey,
    });
    setBusy(false);
    if (saved.error !== undefined || saved.id === undefined) {
      setStatus(saved.error ?? "could not save that provider");
      return;
    }
    setCustom({ label: "", baseUrl: "", apiKey: "" });
    setAdding(false);
    await refresh();
    await pick(saved.id);
    await loadModels(saved.id);
  }

  const activeLabel = accounts.find((item) => item.id === active)?.label ?? "none";

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Models</h2>
      </header>
      <p className="panel__sub">
        {activeLabel} · {current}
      </p>

      {status !== null ? <p className="panel__status">{status}</p> : null}

      <input
        className="panel__input"
        placeholder="API key for the provider you tap"
        value={keyDraft}
        type="password"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setKeyDraft(event.target.value)}
      />

      <ul className="panel__list">
        {accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              className={account.id === active ? "panel__row panel__row--active" : "panel__row"}
              disabled={busy}
              onClick={() => {
                void pick(account.id);
                void loadModels(account.id);
              }}
            >
              <span className="panel__path">{account.label}</span>
              <span className="panel__sub">{account.keySet ? "key set" : "no key"}</span>
            </button>
            {openId === account.id && models.length > 0 ? (
              <ul className="panel__sublist">
                {models.map((model) => (
                  <li key={model.id}>
                    <button
                      type="button"
                      className="panel__row panel__row--sub"
                      disabled={busy}
                      onClick={() => void pick(account.id, model.id)}
                    >
                      <span className="panel__path">{model.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        {accounts.length === 0 ? <li className="panel__empty">No provider yet. Tap one below.</li> : null}
      </ul>

      <span className="panel__label">Add a provider</span>
      <ul className="panel__list">
        {presets
          .filter((preset) => !accounts.some((account) => account.preset === preset.id))
          .map((preset) => (
            <li key={preset.id}>
              <button type="button" className="panel__row" disabled={busy} onClick={() => void addPreset(preset)}>
                <span className="panel__path">{preset.label}</span>
                <span className="panel__sub">{preset.keyHint}</span>
              </button>
            </li>
          ))}
      </ul>

      {adding ? (
        <div className="panel__form">
          <input
            className="panel__input"
            placeholder="Name, e.g. My server"
            value={custom.label}
            onChange={(event) => setCustom({ ...custom, label: event.target.value })}
          />
          <input
            className="panel__input"
            placeholder="http://192.168.1.20:1234/v1"
            value={custom.baseUrl}
            spellCheck={false}
            onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
          />
          <input
            className="panel__input"
            placeholder="API key (empty for a local server)"
            value={custom.apiKey}
            type="password"
            spellCheck={false}
            onChange={(event) => setCustom({ ...custom, apiKey: event.target.value })}
          />
          <button type="button" className="panel__primary" disabled={busy} onClick={() => void addCustom()}>
            Add
          </button>
        </div>
      ) : (
        <button type="button" className="panel__secondary" onClick={() => setAdding(true)}>
          Custom provider
        </button>
      )}
    </section>
  );
}
