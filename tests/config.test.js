const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { readConfig, writeConfig, getConfigPath } = require("../dist/config.js");
const { AgentConfigError, ExitCodes } = require("../dist/errors.js");
const { createDefaultConfig } = require("../dist/templates.js");

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("writeConfig and readConfig round trip", async () => {
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

test("readConfig throws when config is missing", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(() => readConfig(root), (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Validation);
      return true;
    });
  });
});

test("build outputs dist/cli.js", async () => {
  const cliPath = path.join(__dirname, "..", "dist", "cli.js");
  await assert.doesNotReject(fs.access(cliPath));
});
