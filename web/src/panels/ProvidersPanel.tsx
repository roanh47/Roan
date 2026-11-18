import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
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

interface Props {
  client: ChainClient;
  current: string;
  /** Opens the model sheet after a provider was added and activated. */
  onProviderAdded: () => void;
}

/**
 * Providers, not URLs. You tap a provider and paste its key; the base URL
 * comes with it. The preset list is the live models.dev catalogue, so every
 * OpenAI-compatible provider is here, and anything unnamed is added by hand.
 */

const PRESET_PAGE = 60;

export function ProvidersPanel({ client, current, onProviderAdded }: Props): ReactElement {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Preset | null>(null);
  const [addKey, setAddKey] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ label: "", baseUrl: "", apiKey: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const answer = await client.request<{
      presets?: Preset[];
      accounts?: Account[];
      active?: string | null;
      source?: string;
    }>("providers_list");
    setPresets(answer.presets ?? []);
    setAccounts(answer.accounts ?? []);
    setActive(answer.active ?? null);
    setSource(answer.source ?? null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  async function saveKey(account: Account): Promise<void> {
    const key = keyDrafts[account.id] ?? "";
    if (key.trim().length === 0) {
      setStatus("paste a key first");
      return;
    }
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string }>("provider_save", {
      id: account.id,
      label: account.label,
      baseUrl: account.baseUrl,
      apiKey: key.trim(),
    });
    setBusy(false);
    setStatus(answer.error ?? `key saved for ${account.label}`);
    setKeyDrafts((drafts) => ({ ...drafts, [account.id]: "" }));
    await refresh();
  }

  async function makeActive(account: Account): Promise<void> {
    setBusy(true);
    const answer = await client.request<{ error?: string }>("provider_pick", { id: account.id });
    setBusy(false);
    setStatus(answer.error ?? `using ${account.label}`);
    await refresh();
  }

  async function removeAccount(account: Account): Promise<void> {
    setBusy(true);
    await client.request("provider_remove", { id: account.id });
    setBusy(false);
    setExpanded(null);
    await refresh();
  }

  async function addPreset(preset: Preset, key: string): Promise<void> {
    if (key.trim().length === 0) {
      setStatus(`paste the ${preset.label} key first`);
      return;
    }
    setBusy(true);
    const saved = await client.request<{ id?: string; error?: string }>("provider_save", {
      label: preset.label,
      baseUrl: preset.baseUrl,
      apiKey: key.trim(),
      preset: preset.id,
    });
    if (saved.error !== undefined || saved.id === undefined) {
      setBusy(false);
      setStatus(saved.error ?? "could not save that provider");
      return;
    }
    await client.request("provider_pick", { id: saved.id });
    setBusy(false);
    setAdding(null);
    setAddKey("");
    setStatus(`${preset.label} added`);
    onProviderAdded();
    await refresh();
  }

  async function addCustom(): Promise<void> {
    setBusy(true);
    const saved = await client.request<{ id?: string; error?: string }>("provider_save", {
      label: custom.label.trim(),
      baseUrl: custom.baseUrl.trim(),
      apiKey: custom.apiKey.trim(),
    });
    if (saved.error !== undefined || saved.id === undefined) {
      setBusy(false);
      setStatus(saved.error ?? "could not save that provider");
      return;
    }
    await client.request("provider_pick", { id: saved.id });
    setBusy(false);
    setCustom({ label: "", baseUrl: "", apiKey: "" });
    setShowCustom(false);
    onProviderAdded();
    await refresh();
  }

  const activeLabel = accounts.find((item) => item.id === active)?.label ?? "none";

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const unadded = presets.filter((preset) => !accounts.some((account) => account.preset === preset.id));
    if (needle.length === 0) return unadded.slice(0, PRESET_PAGE);
    return unadded.filter((preset) => preset.label.toLowerCase().includes(needle)).slice(0, PRESET_PAGE);
  }, [presets, accounts, search]);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Models &amp; keys</h2>
      </header>
      <p className="panel__sub">
        {activeLabel} · {current}
        {source !== null ? <span className="panel__src"> · {source}</span> : null}
      </p>

      {status !== null ? <p className="panel__status">{status}</p> : null}

      <span className="panel__label">Your providers</span>
      <ul className="panel__list">
        {accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              className={account.id === active ? "panel__row panel__row--active" : "panel__row"}
              onClick={() => setExpanded(expanded === account.id ? null : account.id)}
            >
              <span className="panel__path">{account.label}</span>
              <span className={`panel__key${account.keySet ? " panel__key--set" : ""}`}>
                {account.keySet ? "key set" : "no key"}
              </span>
            </button>
            {expanded === account.id ? (
              <div className="panel__form">
                <input
                  className="panel__input"
                  placeholder={`${account.label} API key`}
                  value={keyDrafts[account.id] ?? ""}
                  type="password"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) =>
                    setKeyDrafts((drafts) => ({ ...drafts, [account.id]: event.target.value }))
                  }
                />
                <div className="panel__actionsrow">
                  <button
                    type="button"
                    className="panel__primary"
                    disabled={busy}
                    onClick={() => void saveKey(account)}
                  >
                    Save key
                  </button>
                  {account.id !== active ? (
                    <button
                      type="button"
                      className="panel__secondary panel__secondary--inline"
                      disabled={busy}
                      onClick={() => void makeActive(account)}
                    >
                      Use this
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="panel__remove"
                    disabled={busy}
                    onClick={() => void removeAccount(account)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
        {accounts.length === 0 ? (
          <li className="panel__empty">No provider yet. Tap one below, paste its key, done.</li>
        ) : null}
      </ul>

      <span className="panel__label">Add a provider</span>
      <input
        className="panel__input"
        placeholder={`Search ${String(presets.length)} providers`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        spellCheck={false}
        autoComplete="off"
      />

      {adding !== null ? (
        <div className="panel__form">
          <span className="panel__subtitle">
            {adding.label}
            <span className="panel__src"> {adding.baseUrl}</span>
          </span>
          <input
            className="panel__input"
            placeholder={adding.keyHint.length > 0 ? adding.keyHint : "API key"}
            value={addKey}
            type="password"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            onChange={(event) => setAddKey(event.target.value)}
          />
          <div className="panel__actionsrow">
            <button type="button" className="panel__primary" disabled={busy} onClick={() => void addPreset(adding, addKey)}>
              Add
            </button>
            <button
              type="button"
              className="panel__secondary panel__secondary--inline"
              onClick={() => {
                setAdding(null);
                setAddKey("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ul className="panel__list">
        {shown.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="panel__row"
              disabled={busy}
              onClick={() => {
                setAdding(preset);
                setAddKey("");
              }}
            >
              <span className="panel__path">{preset.label}</span>
              <span className="panel__src">{preset.keyHint}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="panel__empty">Nothing matches that search.</li> : null}
      </ul>
      {presets.length > PRESET_PAGE && search.trim().length === 0 ? (
        <p className="panel__hint">
          First {String(PRESET_PAGE)} of {String(presets.length)} — search narrows it down.
        </p>
      ) : null}

      {showCustom ? (
        <div className="panel__form">
          <span className="panel__subtitle">A provider that is not on the list</span>
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
            autoCapitalize="off"
            onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
          />
          <input
            className="panel__input"
            placeholder="API key (empty for a local server)"
            value={custom.apiKey}
            type="password"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setCustom({ ...custom, apiKey: event.target.value })}
          />
          <div className="panel__actionsrow">
            <button type="button" className="panel__primary" disabled={busy} onClick={() => void addCustom()}>
              Add
            </button>
            <button
              type="button"
              className="panel__secondary panel__secondary--inline"
              onClick={() => setShowCustom(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="panel__secondary" onClick={() => setShowCustom(true)}>
          Custom provider (URL + key)
        </button>
      )}
    </section>
  );
}
