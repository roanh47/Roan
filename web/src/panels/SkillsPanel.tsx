import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Skills: the procedures Roan knows, how often each is used, and your own.
 *
 * Roan proposes skills from its own work; you can also write one here, read
 * and change any of them, and remove one that is never used. Skills are
 * shared with all your devices.
 */
interface SkillRow {
  name: string;
  description: string;
  files: number;
  uses: number;
  verdict: string;
}

interface Draft {
  name: string;
  description: string;
  body: string;
  /** True while editing an existing skill: its name cannot change. */
  existing: boolean;
}

const EMPTY: Draft = { name: "", description: "", body: "", existing: false };

export function SkillsPanel({ client }: { client: ChainClient }): ReactElement {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void client
      .request<{ ok?: boolean; skills?: SkillRow[]; error?: string }>("skills_overview")
      .then((answer) => {
        if (answer.ok === true) setSkills(answer.skills ?? []);
        else setStatus(answer.error ?? "could not read the skills");
      })
      .catch(() => setStatus("could not read the skills"));
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function open(skill: SkillRow): void {
    void client
      .request<{ ok?: boolean; body?: string; error?: string }>("skill_read", { name: skill.name })
      .then((answer) => {
        if (answer.ok === true) {
          setDraft({ name: skill.name, description: skill.description, body: answer.body ?? "", existing: true });
          setStatus(null);
        } else setStatus(answer.error ?? "could not open the skill");
      })
      .catch(() => setStatus("could not open the skill"));
  }

  function save(): void {
    if (draft === null) return;
    void client
      .request<{ ok?: boolean; name?: string; error?: string }>("skill_save", {
        name: draft.name,
        description: draft.description,
        body: draft.body,
      })
      .then((answer) => {
        if (answer.ok === true) {
          setStatus(`${answer.name ?? draft.name} saved`);
          setDraft(null);
          refresh();
        } else setStatus(answer.error ?? "could not save the skill");
      })
      .catch(() => setStatus("could not save the skill"));
  }

  function remove(name: string): void {
    setConfirming(null);
    void client
      .request<{ ok?: boolean; error?: string }>("skill_delete", { name })
      .then((answer) => {
        if (answer.ok === true) {
          setStatus(`${name} removed`);
          refresh();
        } else setStatus(answer.error ?? "could not remove the skill");
      })
      .catch(() => setStatus("could not remove the skill"));
  }

  const ready =
    draft !== null && draft.name.trim().length > 0 && draft.description.trim().length > 0 && draft.body.trim().length > 0;

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Skills</h2>
      </header>
      <p className="panel__sub">
        Procedures Roan reads when a task calls for one. It proposes new ones from its own work; you can write your own.
      </p>
      {status !== null ? <p className="panel__status">{status}</p> : null}

      {draft !== null ? (
        <div className="panel__form">
          <span className="panel__path">{draft.existing ? `Edit ${draft.name}` : "New skill"}</span>
          {draft.existing ? null : (
            <input
              className="panel__input"
              aria-label="Skill name"
              placeholder="Name, for example deploy-site"
              value={draft.name}
              spellCheck={false}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          )}
          <input
            className="panel__input"
            aria-label="When to use it"
            placeholder="One line: when should Roan use this?"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <textarea
            className="panel__input panel__textarea"
            aria-label="Instructions"
            placeholder="The steps, in order. Commands exactly as they work."
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="panel__primary" disabled={!ready} onClick={save}>
              Save skill
            </button>
            <button type="button" className="panel__secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="panel__primary" onClick={() => setDraft(EMPTY)}>
          Write a skill
        </button>
      )}

      <ul className="panel__list">
        {(skills ?? []).map((skill) => (
          <li key={skill.name} className="panel__item">
            <span className="panel__path">{skill.name}</span>
            <span className="panel__sub">{skill.description}</span>
            <span className="panel__sub">
              {skill.verdict}
              {skill.files > 0 ? ` · ${String(skill.files)} extra ${skill.files === 1 ? "file" : "files"}` : ""}
            </span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="panel__secondary" onClick={() => open(skill)}>
                Open
              </button>
              {confirming === skill.name ? (
                <>
                  <button type="button" className="panel__primary" onClick={() => remove(skill.name)}>
                    Yes, remove it
                  </button>
                  <button type="button" className="panel__secondary" onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="panel__secondary" onClick={() => setConfirming(skill.name)}>
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
        {skills === null ? <li className="panel__empty">Loading…</li> : null}
        {skills !== null && skills.length === 0 ? <li className="panel__empty">No skills yet.</li> : null}
      </ul>
    </section>
  );
}

export default SkillsPanel;
