import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { resolveFromRoot, resolvePath } from "../src/paths";
import { createDefaultConfig } from "../src/templates";
import { syncConfigs } from "../src/sync";
import { getStatus } from "../src/status";
import { AgentConfigError, ExitCodes } from "../src/errors";
import type { AgentConfigFile, MappingFile, ResolvedMapping } from "../src/types";

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
}

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function hashFile(targetPath: string): Promise<string> {
  const stat = await fs.stat(targetPath);
  if (stat.isDirectory()) {
    return await hashDirectory(targetPath);
  }
  const data = await fs.readFile(targetPath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function hashDirectory(targetPath: string): Promise<string> {
  const entries = await fs.readdir(targetPath);
  entries.sort((a, b) => a.localeCompare(b));
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry);
    const entryStat = await fs.stat(fullPath);
    if (entryStat.isDirectory()) {
      hash.update(`dir:${entry}:`);
      hash.update(await hashDirectory(fullPath));
    } else {
      hash.update(`file:${entry}:`);
      hash.update(await hashFile(fullPath));
    }
  }
  return hash.digest("hex");
}

async function hashPath(targetPath: string): Promise<string> {
  const stat = await fs.stat(targetPath);
  if (stat.isDirectory()) {
    return await hashDirectory(targetPath);
  }
  return await hashFile(targetPath);
}

async function assertHashMatch(sourcePath: string, targetPath: string): Promise<void> {
  const sourceHash = await hashPath(sourcePath);
  const targetHash = await hashPath(targetPath);
  assert.equal(targetHash, sourceHash);
}

async function assertHashMatchDebug(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await assertHashMatch(sourcePath, targetPath);
  } catch (error) {
    const sourceStat = await fs.stat(sourcePath);
    const targetStat = await fs.stat(targetPath);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nsource=${sourcePath} (${sourceStat.isDirectory() ? "dir" : "file"})\n` +
        `target=${targetPath} (${targetStat.isDirectory() ? "dir" : "file"})`
    );
  }
}

async function logMappingKinds(mappings: ResolvedMapping[], sourceRoot: string): Promise<string[]> {
  const lines: string[] = [];
  for (const mapping of mappings) {
    const sourcePath = path.isAbsolute(mapping.source)
      ? mapping.source
      : path.join(sourceRoot, mapping.source);
    const targetPath = mapping.target;
    const sourceStat = await fs.stat(sourcePath);
    const targetStat = await fs.stat(targetPath);
    lines.push(
      `${mapping.source} -> ${targetPath} (source:${sourceStat.isDirectory() ? "dir" : "file"}, target:${targetStat.isDirectory() ? "dir" : "file"})`
    );
  }
  return lines;
}

async function dumpTree(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const lines: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      lines.push(`${full}/`);
      lines.push(...(await dumpTree(full)));
    } else {
      lines.push(full);
    }
  }
  return lines;
}

// Helpers for default-mappings sync tests.
async function canCreateSymlink(): Promise<boolean> {
  const temp = await createTempDir();
  const source = path.join(temp, "source.txt");
  const target = path.join(temp, "target.txt");
  try {
    await fs.writeFile(source, "test", "utf8");
    await fs.symlink(source, target);
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function setupDefaultMappingsFixture(): Promise<{
  temp: string;
  sourceRoot: string;
  globalRoot: string;
  projectRoot: string;
  config: AgentConfigFile;
}> {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const globalRoot = path.join(temp, "global");
  const projectRoot = path.join(temp, "project");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(globalRoot, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });

  const config = createDefaultConfig();
  if (!config.agents.claude.global) {
    throw new Error("Missing claude global config");
  }
  if (!config.agents.codex.global) {
    throw new Error("Missing codex global config");
  }
  if (!config.agents.cursor.global) {
    throw new Error("Missing cursor global config");
  }
  if (!config.agents.opencode.global) {
    throw new Error("Missing opencode global config");
  }

  config.agents.claude.global.root = path.join(globalRoot, "claude");
  config.agents.codex.global.root = path.join(globalRoot, "codex");
  config.agents.cursor.global.root = path.join(globalRoot, "cursor");
  config.agents.opencode.global.root = path.join(globalRoot, "opencode");

  await writeFile(path.join(sourceRoot, "agent.md"), "agent");
  await writeFile(path.join(sourceRoot, "rules", "rule.md"), "rule");
  await writeFile(path.join(sourceRoot, "skills", "skill.md"), "skill");
  await writeFile(path.join(sourceRoot, "claude", "settings.json"), '{"hooks":{}}\n');
  await writeFile(path.join(sourceRoot, "claude", "agents", "review.md"), "review");
  await writeFile(path.join(sourceRoot, "claude", "commands", "test.md"), "test");
  await writeFile(path.join(sourceRoot, "agents", "opencode.md"), "opencode-agent");
  await writeFile(path.join(sourceRoot, "commands", "check.md"), "opencode-command");
  await writeFile(path.join(sourceRoot, "cursor", "hooks.json"), '{"hooks":{}}\n');
  await writeFile(path.join(sourceRoot, "cursor", "hooks", "format.sh"), "echo ok\n");

  return { temp, sourceRoot, globalRoot, projectRoot, config };
}

async function assertMappingsMatchHashes(
  mappings: ResolvedMapping[],
  rootLabel: string,
  rootPath: string,
  sourceRoot: string
): Promise<void> {
  try {
    for (const mapping of mappings) {
      await assertHashMatchDebug(mapping.source, mapping.target);
    }
  } catch (error) {
    const tree = await dumpTree(rootPath);
    const mappingInfo = await logMappingKinds(mappings, sourceRoot);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${rootLabel} sync failed: ${message}\n${mappingInfo.join("\n")}\n${tree.join("\n")}`
    );
  }
}

async function assertMappingsAreSymlinks(
  mappings: ResolvedMapping[],
  options: { allowDirectoryCopies?: boolean } = {}
): Promise<void> {
  const allowDirectoryCopies = options.allowDirectoryCopies ?? false;
  const failures: string[] = [];
  for (const mapping of mappings) {
    const sourceStat = await fs.lstat(mapping.source);
    if (allowDirectoryCopies && sourceStat.isDirectory()) {
      continue;
    }
    const stat = await fs.lstat(mapping.target);
    if (!stat.isSymbolicLink()) {
      failures.push(
        `${mapping.target} (${stat.isDirectory() ? "dir" : "file"}) -> expected symlink to ${mapping.source}`
      );
      continue;
    }
    const linkTarget = await fs.readlink(mapping.target);
    if (linkTarget !== mapping.source) {
      failures.push(`${mapping.target} (link:${linkTarget}) -> expected ${mapping.source}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Non-symlink targets:\n${failures.join("\n")}`);
  }
}

function getProfileMappings(config: AgentConfigFile): MappingFile[] {
  const profileName = config.defaults.profile;
  const profile = config.profiles?.[profileName];
  return profile?.files ?? [];
}

function resolveExpectedMappings({
  config,
  sourceRoot,
  mode,
  projectRoot
}: {
  config: AgentConfigFile;
  sourceRoot: string;
  mode: "global" | "project";
  projectRoot: string | null;
}): ResolvedMapping[] {
  const mappings: ResolvedMapping[] = [];
  const profileFiles = getProfileMappings(config);
  const agents = Object.values(config.agents);

  for (const agentConfig of agents) {
    const scopeConfig = mode === "global" ? agentConfig.global : agentConfig.project;
    if (!scopeConfig) {
      continue;
    }

    let root = scopeConfig.root;
    if (mode === "project") {
      if (!projectRoot) {
        throw new Error("Project root is required for project mappings");
      }
      root = root.replace("<project-root>", projectRoot);
    }
    const resolvedRoot = resolvePath(root, process.env);
    for (const mapping of [...scopeConfig.files, ...profileFiles]) {
      mappings.push({
        agent: "test",
        source: resolveFromRoot(sourceRoot, mapping.source),
        target: resolveFromRoot(resolvedRoot, mapping.target),
        mode: "copy"
      });
    }
  }

  return mappings;
}

void test("sync creates symlink targets by default", async () => {
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

void test("sync resolves auto mode to symlink when possible", async () => {
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

void test("sync creates copies when using copy mode", async () => {
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

void test("status detects drifted files", async () => {
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

void test("status resolves auto mode for symlink targets", async () => {
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
  const state = JSON.parse(rawState) as { files: Record<string, { mode: string }> };
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.mode = "auto";
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [{ path: path.join(targetRoot, "AGENTS.md"), status: "ok" }]);
});

void test("status resolves auto mode for file targets", async () => {
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
  const state = JSON.parse(rawState) as { files: Record<string, { mode: string }> };
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.mode = "auto";
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [{ path: path.join(targetRoot, "AGENTS.md"), status: "ok" }]);
});

void test("status drifts when link target metadata is missing", async () => {
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
  const state = JSON.parse(rawState) as { files: Record<string, { linkTarget: string | null }> };
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.linkTarget = null;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [
    { path: path.join(targetRoot, "AGENTS.md"), status: "drifted", reason: "link target changed" }
  ]);
});

void test("status drifts when hash metadata is missing", async () => {
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
  const state = JSON.parse(rawState) as { files: Record<string, { hash: string | null }> };
  const record = state.files[path.join(targetRoot, "AGENTS.md")];
  record.hash = null;
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const status = await getStatus(sourceRoot);
  assert.deepEqual(status, [
    { path: path.join(targetRoot, "AGENTS.md"), status: "drifted", reason: "content changed" }
  ]);
});

void test("sync includes profile mappings", async () => {
  const temp = await createTempDir();
  const sourceRoot = path.join(temp, "source");
  const targetRoot = path.join(temp, "target");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });

  const config = createDefaultConfig();
  config.defaults.profile = "extra";
  config.profiles = {
    ...config.profiles,
    extra: {
      files: [{ source: "profile.md", target: "PROFILE.md" }]
    }
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

void test("sync overwrites non-empty directory targets when force is enabled", async () => {
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

void test("sync overwrites non-empty directory targets when conflict policy is overwrite", async () => {
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

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: false,
    conflictPolicy: "overwrite",
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "AGENTS.md");
  const stat = await fs.lstat(targetPath);
  assert.equal(stat.isSymbolicLink(), true);
});

void test("sync backs up non-empty directory targets when conflict policy is backup", async () => {
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

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: false,
    conflictPolicy: "backup",
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const targetPath = path.join(targetRoot, "AGENTS.md");
  const stat = await fs.lstat(targetPath);
  assert.equal(stat.isSymbolicLink(), true);

  const backupRoot = path.join(sourceRoot, "backup");
  const backupEntries = await fs.readdir(backupRoot);
  assert.equal(backupEntries.length, 1);
  const backupPath = path.join(backupRoot, backupEntries[0], targetDir.replace(/^[/\\]+/, ""));
  const backupContents = await fs.readFile(path.join(backupPath, "nested.txt"), "utf8");
  assert.equal(backupContents, "data");
});

void test("sync skips unmanaged targets when conflict policy is skip", async () => {
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
  const targetPath = path.join(targetRoot, "AGENTS.md");
  await fs.writeFile(targetPath, "existing", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: false,
    conflictPolicy: "skip",
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 0);
  assert.equal(result.skipped.length, 1);
  const contents = await fs.readFile(targetPath, "utf8");
  assert.equal(contents, "existing");
});

void test("sync overwrites unmanaged targets when conflict policy is overwrite", async () => {
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
  const targetPath = path.join(targetRoot, "AGENTS.md");
  await fs.writeFile(targetPath, "existing", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: false,
    conflictPolicy: "overwrite",
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const contents = await fs.readFile(targetPath, "utf8");
  assert.equal(contents, "hello");
});

void test("sync backs up unmanaged targets when conflict policy is backup", async () => {
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
  const targetPath = path.join(targetRoot, "AGENTS.md");
  await fs.writeFile(targetPath, "existing", "utf8");

  const result = await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: false,
    conflictPolicy: "backup",
    agentFilter: "testagent"
  });

  assert.equal(result.updated.length, 1);
  const contents = await fs.readFile(targetPath, "utf8");
  assert.equal(contents, "hello");

  const backupRoot = path.join(sourceRoot, "backup");
  const backupEntries = await fs.readdir(backupRoot);
  assert.equal(backupEntries.length, 1);
  const backupPath = path.join(backupRoot, backupEntries[0], targetPath.replace(/^[/\\]+/, ""));
  const backupContents = await fs.readFile(backupPath, "utf8");
  assert.equal(backupContents, "existing");
});

void test("sync cancels when conflict policy is cancel", async () => {
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
  const targetPath = path.join(targetRoot, "AGENTS.md");
  await fs.writeFile(targetPath, "existing", "utf8");

  await assert.rejects(
    syncConfigs({
      config,
      sourceRoot,
      mode: "global",
      projectRoot: null,
      linkMode: "copy",
      dryRun: false,
      force: false,
      conflictPolicy: "cancel",
      agentFilter: "testagent"
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Conflict);
      return true;
    }
  );
});

void test("sync skips missing source files with warning", async () => {
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
      files: [{ source: "missing.md", target: "AGENTS.md" }]
    }
  };

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

  assert.equal(result.updated.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("Skipping missing source")));
  await assert.rejects(fs.lstat(path.join(targetRoot, "AGENTS.md")), /ENOENT/);
});

void test("sync errors on missing source when strict is enabled", async () => {
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
      files: [{ source: "missing.md", target: "AGENTS.md" }]
    }
  };

  await assert.rejects(
    syncConfigs({
      config,
      sourceRoot,
      mode: "global",
      projectRoot: null,
      linkMode: "copy",
      dryRun: false,
      force: true,
      strict: true,
      agentFilter: "testagent"
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, ExitCodes.Validation);
      assert.ok(error.message.includes("Missing source"));
      return true;
    }
  );
});

void test("sync copies default mappings for all agents", async () => {
  const { sourceRoot, globalRoot, projectRoot, config } = await setupDefaultMappingsFixture();

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "copy",
    dryRun: false,
    force: true
  });

  const globalMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null
  });
  await assertMappingsMatchHashes(globalMappings, "Global", globalRoot, sourceRoot);

  await syncConfigs({
    config,
    sourceRoot,
    mode: "project",
    projectRoot,
    linkMode: "copy",
    dryRun: false,
    force: true
  });

  const projectMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "project",
    projectRoot
  });
  await assertMappingsMatchHashes(projectMappings, "Project", projectRoot, sourceRoot);
});

void test("sync links default mappings for all agents", async () => {
  const { sourceRoot, globalRoot, projectRoot, config } = await setupDefaultMappingsFixture();

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "link",
    dryRun: false,
    force: true
  });

  const globalMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null
  });
  await assertMappingsAreSymlinks(globalMappings, { allowDirectoryCopies: true });
  await assertMappingsMatchHashes(globalMappings, "Global", globalRoot, sourceRoot);

  await syncConfigs({
    config,
    sourceRoot,
    mode: "project",
    projectRoot,
    linkMode: "link",
    dryRun: false,
    force: true
  });

  const projectMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "project",
    projectRoot
  });
  await assertMappingsAreSymlinks(projectMappings, { allowDirectoryCopies: true });
  await assertMappingsMatchHashes(projectMappings, "Project", projectRoot, sourceRoot);
});

void test("sync resolves auto mode for default mappings", async () => {
  const { sourceRoot, globalRoot, projectRoot, config } = await setupDefaultMappingsFixture();
  const canLink = await canCreateSymlink();

  await syncConfigs({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null,
    linkMode: "auto",
    dryRun: false,
    force: true
  });

  const globalMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "global",
    projectRoot: null
  });
  if (canLink) {
    await assertMappingsAreSymlinks(globalMappings, { allowDirectoryCopies: true });
  }
  await assertMappingsMatchHashes(globalMappings, "Global", globalRoot, sourceRoot);

  await syncConfigs({
    config,
    sourceRoot,
    mode: "project",
    projectRoot,
    linkMode: "auto",
    dryRun: false,
    force: true
  });

  const projectMappings = resolveExpectedMappings({
    config,
    sourceRoot,
    mode: "project",
    projectRoot
  });
  if (canLink) {
    await assertMappingsAreSymlinks(projectMappings, { allowDirectoryCopies: true });
  }
  await assertMappingsMatchHashes(projectMappings, "Project", projectRoot, sourceRoot);
});
