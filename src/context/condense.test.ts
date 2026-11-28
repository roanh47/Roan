import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { condense, condensePrompt, plainDigest, splitForCondensing, type PlainMessage } from "./condense.js";

const numbers = (count: number): number[] => Array.from({ length: count }, (_value, index) => index);

const talk: PlainMessage[] = [
  { role: "user", content: "Deploy the site\n  to staging" },
  { role: "assistant", content: "Deployed with scripts/deploy.sh" },
];

describe("where a conversation is cut", () => {
  it("cuts nothing up to the window", () => {
    assert.equal(splitForCondensing(numbers(40)).older.length, 0);
    assert.equal(splitForCondensing(numbers(40)).recent.length, 40);
  });

  it("moves the boundary twenty messages at a time", () => {
    const olderAt = (count: number): number => splitForCondensing(numbers(count)).older.length;
    assert.equal(olderAt(41), 20);
    assert.equal(olderAt(59), 20);
    assert.equal(olderAt(60), 40);
    assert.equal(olderAt(79), 40);
    assert.equal(olderAt(80), 60);
  });

  it("always leaves between twenty and thirty-nine recent messages, in order", () => {
    for (const count of [41, 50, 59, 60, 75, 200]) {
      const { older, recent } = splitForCondensing(numbers(count));
      assert.ok(recent.length >= 20 && recent.length <= 39, `${String(count)} -> ${String(recent.length)}`);
      assert.deepEqual([...older, ...recent], numbers(count));
    }
  });
});

describe("the summary of the older part", () => {
  it("is the model's when it answers", async () => {
    let asked = "";
    const written = await condense(talk, async (prompt) => {
      asked = prompt;
      return "  ## Goal\nDeploy.  ";
    });
    assert.equal(written, "## Goal\nDeploy.");
    assert.match(asked, /OWNER: Deploy the site to staging/);
    assert.match(asked, /ROAN: Deployed with scripts\/deploy\.sh/);
  });

  it("is the plain list when there is no model, it fails, or it says nothing", async () => {
    const plain = "- Owner: Deploy the site to staging\n- Roan: Deployed with scripts/deploy.sh";
    assert.equal(plainDigest(talk), plain);
    assert.equal(await condense(talk), plain);
    assert.equal(
      await condense(talk, async () => {
        throw new Error("provider down");
      }),
      plain,
    );
    assert.equal(await condense(talk, async () => "   "), plain);
  });

  it("is empty for nothing, and asks for the four headings", async () => {
    assert.equal(await condense([]), "");
    const prompt = condensePrompt(talk);
    for (const heading of ["## Goal", "## Decisions", "## Done", "## Open"]) assert.ok(prompt.includes(heading));
  });
});
