import type { ReactElement } from "react";
import type { SkillProposal } from "../../../src/skills/fold.js";

/**
 * Skills the agent wants to keep, waiting for the owner.
 *
 * The agent can only propose. This is where a person reads what it wrote and
 * says yes or no; until then the text is in the chain and nowhere else. With
 * nothing waiting the component renders nothing.
 */
export interface SkillProposalsProps {
  proposals: readonly SkillProposal[];
  onAnswer: (id: string, approve: boolean) => void;
}

export function SkillProposals({ proposals, onAnswer }: SkillProposalsProps): ReactElement | null {
  if (proposals.length === 0) return null;
  return (
    <div className="skillproposals" role="region" aria-label="Skills Roan proposes">
      {proposals.map((proposal) => (
        <div key={proposal.id} className="approval" data-resolved="open">
          <details style={{ flex: 1, minWidth: 0 }}>
            <summary style={{ cursor: "pointer" }}>
              Roan wants to save a skill: <strong>{proposal.name}</strong> — {proposal.description}
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.45 }}>
              {proposal.body}
            </pre>
          </details>
          <span className="approval__buttons">
            <button type="button" onClick={() => onAnswer(proposal.id, true)}>
              Save skill
            </button>
            <button type="button" className="approval__deny" onClick={() => onAnswer(proposal.id, false)}>
              Dismiss
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

export default SkillProposals;
