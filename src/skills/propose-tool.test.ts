import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SKILL_APPROVAL_KIND, SKILL_REJECTION_KIND, foldSkillProposals, proposedSkills } from "./fold.js";
import { approveSkillOnce, type SkillProposalAppend } from "./proposal.js";
import { createSkillProposeTool, installSkill } from "./propose-tool.js";

const ctx = { cwd: "." };

function harness() {
  const events: { type: string; data: unknown; seq: number }[] = [];
  let counter = 0;
  const tool = createSkillProposeTool({
    append: (event: SkillProposalAppend) => {
      events.push({ type: event.type, data: event.data, seq: events.length + 1 });
    },
    newId: () => {
      counter += 1;
      return `p${String(counter)}`;
    },
  });
  const answer = (kind: string, id: string): void => {
    events.push({ type: "env", data: { kind, id, status: "approved" }, seq: events.length + 1 });
  };
  return { events, tool, answer };
}

const skill = { name: "Deploy Site", description: "How to deploy the site", body: "1. build\n2. push" };

describe("skill_propose", () => {
  it("appends a pending proposal and saves nothing", async () => {
    const { events, tool } = harness();
    const said = await tool.run(skill, ctx);
    assert.match(said, /only if the owner approves/);
    const pending = proposedSkills(events);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.name, "deploy-site");
    assert.equal(pending[0]?.status, "pending");
  });

  it("refuses an unusable name, an empty body and an empty description", async () => {
    const { events, tool } = harness();
    await assert.rejects(tool.run({ ...skill, name: "!!" }, ctx), /name/);
    await assert.rejects(tool.run({ ...skill, body: "  " }, ctx), /body is empty/);
    await assert.rejects(tool.run({ ...skill, description: "" }, ctx), /description is empty/);
    assert.equal(events.length, 0);
  });

  it("treats a second proposal for the same name as its own question", async () => {
    const { events, tool, answer } = harness();
    await tool.run(skill, ctx);
    const first = proposedSkills(events)[0];
    assert.ok(first);
    answer(SKILL_APPROVAL_KIND, first.id);
    await tool.run({ ...skill, body: "1. build\n2. test\n3. push" }, ctx);
    const all = foldSkillProposals(events);
    assert.deepEqual(all.map((proposal) => proposal.status), ["approved", "pending"]);
    assert.equal(all[0]?.body, "1. build\n2. push");
  });

  it("lets the owner refuse, and a refused proposal cannot be approved afterwards", async () => {
    const { events, tool, answer } = harness();
    await tool.run(skill, ctx);
    const first = proposedSkills(events)[0];
    assert.ok(first);
    answer(SKILL_REJECTION_KIND, first.id);
    assert.equal(foldSkillProposals(events)[0]?.status, "rejected");
    assert.equal(proposedSkills(events).length, 0);
    assert.equal(approveSkillOnce(events, first.id), null);
  });
});

describe("installSkill", () => {
  it("writes SKILL.md under the skill's own directory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "roan-skill-"));
    try {
      const file = await installSkill(home, { name: "deploy-site", description: "How to deploy", body: "1. build" });
      assert.equal(file, path.join(home, "skills", "deploy-site", "SKILL.md"));
      const text = await readFile(file, "utf8");
      assert.match(text, /deploy-site/);
      assert.match(text, /1\. build/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
