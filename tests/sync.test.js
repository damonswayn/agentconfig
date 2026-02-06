const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { createDefaultConfig } = require("../dist/templates.js");
const { syncConfigs } = require("../dist/sync.js");
const { getStatus } = require("../dist/status.js");

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
}

test("sync creates symlink targets by default", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "AGENTS.md");
  const stat = await fs.lstat(targetPath);
  assert.equal(stat.isSymbolicLink(), true);
});

test("sync resolves auto mode to symlink when possible", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "auto",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "AGENTS.md");
  const stat = await fs.lstat(targetPath);
  assert.equal(stat.isSymbolicLink(), true);
});

test("sync creates copies when using copy mode", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "AGENTS.md");
  const stat = await fs.lstat(targetPath);
  assert.equal(stat.isSymbolicLink(), false);
  const contents = await fs.readFile(targetPath, "utf8");
  assert.equal(contents, "hello");
});

test("status detects drifted files", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  await fs.writeFile(path.join(targetRoot, "AGENTS.md"), "changed", "utf8");
  const status = await getStatus(sourceRoot);
  const drifted = status.find((entry) => entry.status === "drifted");
  assert.ok(drifted, "expected drifted entry");
});

test("status resolves auto mode for symlink targets", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  const statePath = path.join(sourceRoot, ".sync-state.json");
  const rawState = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(rawState);
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.mode = "auto";
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [{ path: path.join(targetRoot, "AGENTS.md"), status: "ok" }]);
});

test("status resolves auto mode for file targets", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  const statePath = path.join(sourceRoot, ".sync-state.json");
  const rawState = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(rawState);
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.mode = "auto";
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [{ path: path.join(targetRoot, "AGENTS.md"), status: "ok" }]);
});

test("status drifts when link target metadata is missing", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  const statePath = path.join(sourceRoot, ".sync-state.json");
  const rawState = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(rawState);
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.linkTarget = null;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [
    { path: path.join(targetRoot, "AGENTS.md"), status: "drifted", reason: "link target changed" }
  ]);
});

test("status drifts when hash metadata is missing", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  const statePath = path.join(sourceRoot, ".sync-state.json");
  const rawState = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(rawState);
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.hash = null;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [
    { path: path.join(targetRoot, "AGENTS.md"), status: "drifted", reason: "content changed" }
  ]);
});

test("sync includes profile mappings", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.defaults.profile = "extra";
  config.profiles.extra = {
    files: [{ source: "profile.md", target: "PROFILE.md" }]
  };
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: []
    }
  };
  await fs.writeFile(path.join(sourceRoot, "profile.md"), "profile", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true,
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "PROFILE.md");
  const contents = await fs.readFile(targetPath, "utf8");
  assert.equal(contents, "profile");
});

test("sync refuses to replace non-empty directory targets", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.agents.testagent = {
    displayName: "Test",
    global: {
      root: targetRoot,
      files: [{ source: "agent.md", target: "AGENTS.md" }]
    }
  };
  await fs.writeFile(path.join(sourceRoot, "agent.md"), "hello", "utf8");

  const targetDir = path.join(targetRoot, "AGENTS.md");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "nested.txt"), "data", "utf8");

  await assert.rejects(
    syncConfigs({
      config,
      sourceRoot,
      mode: "global",
      projectRoot: null,
      linkMode: "link",
      dryRun: false,
      force: true,
      agentFilter: "testagent"
    }),
    /Refusing to replace non-empty directory/
  );
});
