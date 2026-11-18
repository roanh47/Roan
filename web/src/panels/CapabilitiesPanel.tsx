import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

interface Skill {
  name: string;
  description: string;
  files: number;
}

interface ToolInfo {
  name: string;
  description: string;
}

interface Props {
  client: ChainClient;
}

type Tab = "tools" | "skills" | "mcp";

/**
 * What the agent can actually do, on this device.
 *
 * Three lists, because they are three different things: tools are the functions
 * a turn may call, skills are procedures on disk that load only when relevant,
 * and MCP is the file that describes external servers. Nothing here invents a
 * setting the daemon does not have — the MCP tab says plainly that the builtin
 * engine does not start servers yet.
 */
export function CapabilitiesPanel({ client }: Props): ReactElement {
  const [tab, setTab] = useState<Tab>("tools");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [engine, setEngine] = useState<string>("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsRoot, setSkillsRoot] = useState<string>("");
  const [mcpPath, setMcpPath] = useState<string>("");
  const [mcpText, setMcpText] = useState<string>("");
  const [mcpStarted, setMcpStarted] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const answer = await client.request<{ tools?: ToolInfo[]; engine?: string }>("tools_list");
      setTools(answer.tools ?? []);
      setEngine(answer.engine ?? "");
      const skillAnswer = await client.request<{ skills?: Skill[]; root?: string }>("skills_list");
      setSkills(skillAnswer.skills ?? []);
      setSkillsRoot(skillAnswer.root ?? "");
      const mcpAnswer = await client.request<{ path?: string; text?: string; started?: boolean }>("mcp_list");
      setMcpPath(mcpAnswer.path ?? "");
      setMcpText(mcpAnswer.text ?? "");
      setMcpStarted(mcpAnswer.started === true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveMcp(): Promise<void> {
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string }>("mcp_save", { text: mcpText });
    setBusy(false);
    setStatus(answer.error ?? "saved; it travels with the chain");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Agent</h2>
      </header>

      <div className="panel__tabs">
        {(["tools", "skills", "mcp"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "panel__tab panel__tab--active" : "panel__tab"}
            onClick={() => setTab(id)}
          >
            {id === "tools" ? "Tools" : id === "skills" ? "Skills" : "MCP"}
          </button>
        ))}
      </div>

      {status !== null ? <p className="panel__status">{status}</p> : null}

      {tab === "tools" ? (
        <>
          <p className="panel__sub">engine: {engine === "" ? "…" : engine} · {tools.length} tools</p>
          <ul className="panel__list">
            {tools.map((tool) => (
              <li key={tool.name} className="panel__item">
                <span className="panel__path">{tool.name}</span>
                <span className="panel__sub">{tool.description}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {tab === "skills" ? (
        <>
          <p className="panel__sub">{skills.length} skills · {skillsRoot}</p>
          <ul className="panel__list">
            {skills.map((skill) => (
              <li key={skill.name} className="panel__item">
                <span className="panel__path">{skill.name}</span>
                <span className="panel__sub">{skill.description}</span>
              </li>
            ))}
            {skills.length === 0 ? <li className="panel__empty">No skills on this device yet.</li> : null}
          </ul>
        </>
      ) : null}

      {tab === "mcp" ? (
        <>
          <p className="panel__sub">{mcpPath}</p>
          {mcpStarted ? null : (
            <p className="panel__status">The builtin engine does not start MCP servers yet; the file does travel with the chain.</p>
          )}
          <textarea
            className="panel__input panel__textarea"
            value={mcpText}
            spellCheck={false}
            rows={12}
            onChange={(event) => setMcpText(event.target.value)}
          />
          <button type="button" className="panel__primary" disabled={busy} onClick={() => void saveMcp()}>
            Save
          </button>
        </>
      ) : null}
    </section>
  );
}
