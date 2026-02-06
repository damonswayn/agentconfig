import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, writeConfig, getConfigPath } from "../src/config";
import { AgentConfigError, ExitCodes } from "../src/errors";
import { createDefaultConfig } from "../src/templates";

async function withTempDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

void test("writeConfig and readConfig round trip", async () => {
  await withTempDir(async (root) => {
    const config = createDefaultConfig();
    await writeConfig(root, config);

    const loaded = await readConfig(root);
    assert.deepStrictEqual(loaded, config);

    const configPath = getConfigPath(root);
    const raw = await fs.readFile(configPath, "utf8");
    assert.match(raw, /version:\s*1/);
  });
});

void test("readConfig throws when config is missing", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(
      () => readConfig(root),
      (error) => {
        assert.ok(error instanceof AgentConfigError);
        assert.equal(error.code, ExitCodes.Validation);
        return true;
      }
    );
  });
});

void test("build outputs dist/cli.js", async () => {
  const cliPath = path.join(process.cwd(), "dist", "cli.js");
  await assert.doesNotReject(fs.access(cliPath));
});
