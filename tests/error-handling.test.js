const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { readConfig } = require("../dist/config.js");
const { readState } = require("../dist/state.js");
const { AgentConfigError, ExitCodes } = require("../dist/errors.js");

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
}

test("readConfig throws AgentConfigError when config is missing", async () => {
  const temp = await createTempDir();
  await assert.rejects(
    readConfig(temp),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Validation);
      assert.match(error.message, /Missing config/);
      return true;
    }
  );
});

test("readConfig includes details for invalid YAML", async () => {
  const temp = await createTempDir();
  const configPath = path.join(temp, "agentconfig.yml");
  await fs.writeFile(configPath, "defaults:\n  mode: [", "utf8");
  await assert.rejects(
    readConfig(temp),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Validation);
      assert.match(error.message, /Invalid YAML in/);
      assert.match(error.message, /line/);
      return true;
    }
  );
});

test("readState returns null when state is missing", async () => {
  const temp = await createTempDir();
  const state = await readState(temp);
  assert.equal(state, null);
});

test("readState throws AgentConfigError for invalid JSON", async () => {
  const temp = await createTempDir();
  const statePath = path.join(temp, ".sync-state.json");
  await fs.writeFile(statePath, "{", "utf8");
  await assert.rejects(
    readState(temp),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Validation);
      assert.match(error.message, /Invalid JSON in/);
      return true;
    }
  );
});
