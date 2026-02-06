import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig } from "../src/config";
import { readState } from "../src/state";
import { AgentConfigError, ExitCodes } from "../src/errors";

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
}

void test("readConfig throws AgentConfigError when config is missing", async () => {
  const temp = await createTempDir();
  await assert.rejects(readConfig(temp), (error) => {
    assert.ok(error instanceof AgentConfigError);
    assert.equal(error.code, ExitCodes.Validation);
    assert.match(error.message, /Missing config/);
    return true;
  });
});

void test("readConfig includes details for invalid YAML", async () => {
  const temp = await createTempDir();
  const configPath = path.join(temp, "agentconfig.yml");
  await fs.writeFile(configPath, "defaults:\n  mode: [", "utf8");
  await assert.rejects(readConfig(temp), (error) => {
    assert.ok(error instanceof AgentConfigError);
    assert.equal(error.code, ExitCodes.Validation);
    assert.match(error.message, /Invalid YAML in/);
    assert.match(error.message, /line/);
    return true;
  });
});

void test("readState returns null when state is missing", async () => {
  const temp = await createTempDir();
  const state = await readState(temp);
  assert.equal(state, null);
});

void test("readState throws AgentConfigError for invalid JSON", async () => {
  const temp = await createTempDir();
  const statePath = path.join(temp, ".sync-state.json");
  await fs.writeFile(statePath, "{", "utf8");
  await assert.rejects(readState(temp), (error) => {
    assert.ok(error instanceof AgentConfigError);
    assert.equal(error.code, ExitCodes.Validation);
    assert.match(error.message, /Invalid JSON in/);
    return true;
  });
});
