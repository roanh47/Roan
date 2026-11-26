import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES, isRole, roleModel, roleModelOr, type RoleModels } from "./roles.js";

test("with no pins every role inherits the configured model", () => {
  const config: RoleModels = { model: "qwen3-coder" };
  for (const role of ROLES) {
    assert.equal(roleModel(role, config), "qwen3-coder");
  }
});

test("a pin wins for its own role and leaves the others inheriting", () => {
  const config: RoleModels = { model: "qwen3-coder", roles: { planner: "claude-opus" } };
  assert.equal(roleModel("planner", config), "claude-opus");
  assert.equal(roleModel("executor", config), "qwen3-coder");
  assert.equal(roleModel("side", config), "qwen3-coder");
});

test("an empty pin inherits instead of blanking the model", () => {
  const config: RoleModels = { model: "qwen3-coder", roles: { planner: "   " } };
  assert.equal(roleModel("planner", config), "qwen3-coder");

  const noBase: RoleModels = { model: "qwen3-coder", roles: { executor: "" } };
  assert.equal(roleModel("executor", noBase), "qwen3-coder");
});

test("the side role takes the cheap side model by default", () => {
  const config: RoleModels = { model: "claude-opus", sideModel: "haiku" };
  assert.equal(roleModel("side", config), "haiku");
  assert.equal(roleModel("planner", config), "claude-opus");
  assert.equal(roleModel("executor", config), "claude-opus");
});

test("a side pin beats the cheap side default", () => {
  const config: RoleModels = { model: "claude-opus", sideModel: "haiku", roles: { side: "gpt-mini" } };
  assert.equal(roleModel("side", config), "gpt-mini");
});

test("a blank side model falls back to the inherited model", () => {
  assert.equal(roleModel("side", { model: "claude-opus", sideModel: "  " }), "claude-opus");
});

test("an unknown role inherits and never reads the pins table", () => {
  const config: RoleModels = { model: "qwen3-coder", roles: { planner: "claude-opus" } };
  assert.equal(roleModel("reviewer", config), "qwen3-coder");
  assert.equal(roleModel("", config), "qwen3-coder");
  assert.equal(roleModel("constructor", config), "qwen3-coder");
  assert.equal(roleModel("__proto__", config), "qwen3-coder");
  assert.equal(roleModel(" toString ", config), "qwen3-coder");
});

test("no model anywhere resolves to null, not to a guess", () => {
  assert.equal(roleModel("planner"), null);
  assert.equal(roleModel("side", { sideModel: " " }), null);
  assert.equal(roleModel("planner", { model: "" }), null);
});

test("a model id is trimmed and other types are ignored", () => {
  const config = { model: "  qwen3-coder ", roles: { planner: "claude-opus\n" } } as RoleModels;
  assert.equal(roleModel("planner", config), "claude-opus");
  assert.equal(roleModel("executor", config), "qwen3-coder");

  const wrong: RoleModels = { model: 7 as unknown as string, roles: { executor: 7 as unknown as string } };
  assert.equal(roleModel("executor", wrong), null);
});

test("roleModelOr falls back only when the config names nothing", () => {
  assert.equal(roleModelOr("planner", { model: "qwen3-coder" }, "local-model"), "qwen3-coder");
  assert.equal(roleModelOr("executor", {}, "local-model"), "local-model");
});

test("isRole knows exactly the three roles", () => {
  assert.deepEqual([...ROLES], ["planner", "executor", "side"]);
  for (const role of ROLES) assert.equal(isRole(role), true);
  assert.equal(isRole("reviewer"), false);
  assert.equal(isRole(undefined), false);
});
