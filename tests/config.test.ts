import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, writeConfig, getConfigPath } from "../src/config";
import { ensureSourceDirectories, initConfig } from "../src/init";
import { resolveFromRoot } from "../src/paths";
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

void test("ensureSourceDirectories creates missing source directories", async () => {
  await withTempDir(async (root) => {
    const config = createDefaultConfig();
    await ensureSourceDirectories(config, root);

    const expected = ["claude/agents/", "claude/commands/", "skills/", "rules/", "agents/"];
    await Promise.all(
      expected.map(async (source) => {
        const resolved = resolveFromRoot(root, source);
        const stat = await fs.lstat(resolved);
        assert.equal(stat.isDirectory(), true);
      })
    );
  });
});

void test("initConfig overwrites existing config when forced", async () => {
  await withTempDir(async (root) => {
    const config = createDefaultConfig();
    await writeConfig(root, config);
    const markerPath = path.join(root, "marker.txt");
    await fs.writeFile(markerPath, "original", "utf8");

    const result = await initConfig(root, {
      config,
      conflictPolicy: "overwrite"
    });

    assert.equal(result.action, "overwritten");
    const contents = await fs.readFile(markerPath, "utf8");
    assert.equal(contents, "original");
  });
});

void test("initConfig skips existing config when requested", async () => {
  await withTempDir(async (root) => {
    const config = createDefaultConfig();
    await writeConfig(root, config);

    const result = await initConfig(root, {
      config,
      conflictPolicy: "skip"
    });

    assert.equal(result.action, "skipped");
  });
});

void test("initConfig backs up existing config", async () => {
  await withTempDir(async (root) => {
    const config = createDefaultConfig();
    await writeConfig(root, config);

    const result = await initConfig(root, {
      config,
      conflictPolicy: "backup"
    });

    assert.equal(result.action, "overwritten");
    const configPath = getConfigPath(root);
    const backupRoot = path.join(root, "backup");
    const backupEntries = await fs.readdir(backupRoot);
    assert.equal(backupEntries.length, 1);
    const backupPath = path.join(backupRoot, backupEntries[0], path.basename(configPath));
    await assert.doesNotReject(() => fs.access(backupPath));
  });
});
