import fs from "fs/promises";
import os from "os";
import path from "path";
import { createInterface } from "readline/promises";
import { AgentConfigError, ExitCodes } from "./errors";
import { copyFileOrDir, ensureDir, fileExists, hashPath, readLinkTarget } from "./filesystem";
import { resolveFromRoot, resolvePath } from "./paths";
import { readState, writeState } from "./state";
import type {
  AgentConfigFile,
  ConflictPolicy,
  ResolvedMapping,
  SyncMode,
  SyncRecord,
  SyncState
} from "./types";

export interface SyncOptions {
  config: AgentConfigFile;
  sourceRoot: string;
  mode: "global" | "project";
  projectRoot: string | null;
  linkMode: SyncMode;
  dryRun: boolean;
  force: boolean;
  conflictPolicy?: ConflictPolicy;
  agentFilter?: string;
  strict?: boolean;
}

export interface SyncResult {
  planned: ResolvedMapping[];
  updated: ResolvedMapping[];
  skipped: ResolvedMapping[];
  warnings: string[];
}

export async function syncConfigs(options: SyncOptions): Promise<SyncResult> {
  const {
    config,
    sourceRoot,
    mode,
    projectRoot,
    linkMode,
    dryRun,
    force,
    conflictPolicy,
    agentFilter,
    strict
  } = options;
  const strictMode = strict ?? false;
  const resolvedMode = await resolveSyncMode(linkMode);
  const resolvedMappings = resolveMappings(
    config,
    sourceRoot,
    mode,
    projectRoot,
    resolvedMode,
    agentFilter
  );
  const warnings: string[] = [];

  const stateRoot = sourceRoot;
  const existingState = await readState(stateRoot);
  const updatedMappings: ResolvedMapping[] = [];
  const skippedMappings: ResolvedMapping[] = [];
  let conflictState: ConflictState = { policy: conflictPolicy ?? null, canAsk: true };

  for (const mapping of resolvedMappings) {
    const policyAllowsOverwrite =
      conflictState.policy === "overwrite" || conflictState.policy === "backup";
    const managedTarget = isManaged(mapping.target, existingState);
    let allowNonEmptyDir = force || policyAllowsOverwrite || managedTarget;

    const sourceExists = await fileExists(mapping.source);
    if (!sourceExists) {
      if (strictMode) {
        throw new AgentConfigError(`Missing source: ${mapping.source}`, ExitCodes.Validation);
      }
      warnings.push(`Skipping missing source: ${mapping.source}`);
      skippedMappings.push(mapping);
      continue;
    }

    const targetExists = await fileExists(mapping.target);
    if (targetExists && !force && !managedTarget) {
      const decision = await resolveConflictPolicy(mapping.target, conflictState);
      conflictState = decision.state;
      if (decision.action === "cancel") {
        throw new AgentConfigError("Sync cancelled", ExitCodes.Conflict);
      }
      if (decision.action === "skip") {
        warnings.push(`Skipping unmanaged target: ${mapping.target}`);
        skippedMappings.push(mapping);
        continue;
      }
      if (decision.action === "backup") {
        if (!dryRun) {
          await backupTarget(mapping.target, sourceRoot);
        }
        allowNonEmptyDir = true;
      }
      if (decision.action === "overwrite") {
        allowNonEmptyDir = true;
      }
    }

    if (dryRun) {
      continue;
    }

    try {
      await applyMapping(mapping, warnings, { allowNonEmptyDir });
    } catch (error) {
      if (error instanceof AgentConfigError) {
        throw error;
      }
      throw new AgentConfigError(`Failed to sync ${mapping.target}`, ExitCodes.Filesystem);
    }

    updatedMappings.push(mapping);
  }

  if (!dryRun) {
    const newState = await buildState(stateRoot, mode, projectRoot, updatedMappings, existingState);
    await writeState(stateRoot, newState);
  }

  return {
    planned: resolvedMappings,
    updated: updatedMappings,
    skipped: skippedMappings,
    warnings
  };
}

interface ConflictState {
  policy: ConflictPolicy | null;
  canAsk: boolean;
}

interface ConflictDecision {
  action: ConflictPolicy;
  state: ConflictState;
}

async function resolveConflictPolicy(
  target: string,
  state: ConflictState
): Promise<ConflictDecision> {
  if (state.policy) {
    return { action: state.policy, state };
  }

  if (!state.canAsk || !process.stdin.isTTY || !process.stdout.isTTY) {
    return { action: "skip", state: { ...state, policy: "skip" } };
  }

  const choice = await promptConflictAction(target);
  const resolved = choice.applyToAll ? choice.action : null;
  return { action: choice.action, state: { policy: resolved, canAsk: !choice.applyToAll } };
}

async function promptConflictAction(
  target: string
): Promise<{ action: ConflictPolicy; applyToAll: boolean }> {
  const promptLines = [
    `Config already exists at ${target}. Choose action:`,
    "1) Overwrite",
    "2) Backup then overwrite",
    "3) Skip",
    "4) Cancel"
  ];
  process.stdout.write(`${promptLines.join("\n")}\n> `);

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const choice = await readline.question("");
  const applyToAllAnswer = await readline.question("Apply to all conflicts? (y/N) ");
  readline.close();

  const applyToAll = /^(y|yes)$/i.test(applyToAllAnswer.trim());
  const selection = Number.parseInt(choice.trim(), 10);
  switch (selection) {
    case 1:
      return { action: "overwrite", applyToAll };
    case 2:
      return { action: "backup", applyToAll };
    case 4:
      return { action: "cancel", applyToAll };
    case 3:
    default:
      return { action: "skip", applyToAll };
  }
}

async function backupTarget(target: string, sourceRoot: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(sourceRoot, "backup", timestamp);
  const relativeTarget = target.replace(/^[/\\]+/, "");
  const destination = path.join(backupRoot, relativeTarget);
  await ensureDir(path.dirname(destination));
  await copyFileOrDir(target, destination);
}

function resolveMappings(
  config: AgentConfigFile,
  sourceRoot: string,
  mode: "global" | "project",
  projectRoot: string | null,
  linkMode: SyncMode,
  agentFilter?: string
): ResolvedMapping[] {
  const mappings: ResolvedMapping[] = [];
  const agents = Object.entries(config.agents);
  const profileFiles = getProfileFiles(config);

  for (const [agent, agentConfig] of agents) {
    if (agentFilter && agentFilter !== agent) {
      continue;
    }
    const scopeConfig = mode === "global" ? agentConfig.global : agentConfig.project;
    if (!scopeConfig) {
      continue;
    }

    let root = scopeConfig.root;
    if (mode === "project") {
      if (!projectRoot) {
        throw new AgentConfigError(
          "Project root is required for project mode",
          ExitCodes.Validation
        );
      }
      root = root.replace("<project-root>", projectRoot);
    }
    const resolvedRoot = resolvePath(root, process.env);

    for (const mapping of [...scopeConfig.files, ...profileFiles]) {
      const source = resolveFromRoot(sourceRoot, mapping.source);
      const target = resolveFromRoot(resolvedRoot, mapping.target);
      mappings.push({
        agent,
        source,
        target,
        mode: linkMode
      });
    }
  }

  return mappings;
}

function getProfileFiles(config: AgentConfigFile): { source: string; target: string }[] {
  const profileName = config.defaults.profile;
  const profile = config.profiles?.[profileName];
  return profile?.files ?? [];
}

async function resolveSyncMode(linkMode: SyncMode): Promise<SyncMode> {
  if (linkMode !== "auto") {
    return linkMode;
  }
  const canLink = await canCreateSymlink();
  return canLink ? "link" : "copy";
}

async function canCreateSymlink(): Promise<boolean> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentconfig-"));
  const source = path.join(tempRoot, "source");
  const target = path.join(tempRoot, "target");
  try {
    await fs.writeFile(source, "test", "utf8");
    await fs.symlink(source, target);
    return true;
  } catch (_error) {
    return false;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function applyMapping(
  mapping: ResolvedMapping,
  warnings: string[],
  options?: { allowNonEmptyDir: boolean }
): Promise<void> {
  const allowNonEmptyDir = options?.allowNonEmptyDir ?? false;

  if (mapping.mode === "copy") {
    await applyCopyMapping(mapping, { allowNonEmptyDir });
    return;
  }

  const targetParent = path.dirname(path.resolve(mapping.target));
  await ensureTargetParent(targetParent, mapping.target, warnings);
  try {
    const sourceStat = await fs.lstat(mapping.source);
    const existing = await getTargetInfo(mapping.target);
    if (existing) {
      if (existing.isSymlink) {
        if (existing.linkTarget === mapping.source) {
          return;
        }
        await fs.unlink(mapping.target);
      } else if (existing.isDirectory) {
        const removed = await removeDirectory(mapping.target, allowNonEmptyDir);
        if (!removed) {
          throw new AgentConfigError(
            `Refusing to replace non-empty directory: ${mapping.target}`,
            ExitCodes.Filesystem
          );
        }
      } else {
        await fs.unlink(mapping.target);
      }
    }
    await fs.symlink(mapping.source, mapping.target, sourceStat.isDirectory() ? "dir" : "file");
  } catch (error) {
    if (error instanceof AgentConfigError) {
      throw error;
    }
    warnings.push(
      `Symlink failed for ${mapping.target} (${formatError(error)}); falling back to copy`
    );
    await applyCopyMapping(mapping, { allowNonEmptyDir });
  }
}

async function applyCopyMapping(
  mapping: ResolvedMapping,
  options?: { allowNonEmptyDir: boolean }
): Promise<void> {
  const allowNonEmptyDir = options?.allowNonEmptyDir ?? false;
  const sourceStat = await fs.lstat(mapping.source);
  const existing = await getTargetInfo(mapping.target);
  const targetParent = path.dirname(path.resolve(mapping.target));
  if (sourceStat.isDirectory()) {
    if (existing && !existing.isDirectory) {
      await fs.unlink(mapping.target);
    }
    if (existing?.isDirectory) {
      const removed = await removeDirectory(mapping.target, allowNonEmptyDir);
      if (!removed) {
        throw new AgentConfigError(
          `Refusing to replace non-empty directory: ${mapping.target}`,
          ExitCodes.Filesystem
        );
      }
    }
    await ensureTargetParent(targetParent, mapping.target);
    await copyFileOrDir(mapping.source, mapping.target);
    return;
  }

  if (existing?.isDirectory) {
    const removed = await removeDirectory(mapping.target, allowNonEmptyDir);
    if (!removed) {
      throw new AgentConfigError(
        `Refusing to replace non-empty directory: ${mapping.target}`,
        ExitCodes.Filesystem
      );
    }
  } else if (existing) {
    await fs.unlink(mapping.target);
  }

  await ensureTargetParent(targetParent, mapping.target);
  await copyFileOrDir(mapping.source, mapping.target);
}

async function ensureTargetParent(
  targetParent: string,
  target: string,
  warnings?: string[]
): Promise<void> {
  const parentExists = await fileExists(targetParent);
  if (!parentExists) {
    await ensureDir(targetParent);
    warnings?.push(`Created target parent directory: ${targetParent} (for ${target})`);
    return;
  }
  await ensureDir(targetParent);
}

async function getTargetInfo(
  target: string
): Promise<null | { isDirectory: boolean; isSymlink: boolean; linkTarget: string | null }> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      return {
        isDirectory: false,
        isSymlink: true,
        linkTarget: await readLinkTarget(target)
      };
    }
    return {
      isDirectory: stat.isDirectory(),
      isSymlink: false,
      linkTarget: null
    };
  } catch (_error) {
    return null;
  }
}

async function removeEmptyDirectory(target: string): Promise<boolean> {
  const entries = await fs.readdir(target);
  if (entries.length > 0) {
    return false;
  }
  await fs.rmdir(target);
  return true;
}

async function removeDirectory(target: string, allowNonEmptyDir: boolean): Promise<boolean> {
  if (!allowNonEmptyDir) {
    return await removeEmptyDirectory(target);
  }
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

function formatError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    const message = error instanceof Error ? error.message : String(error);
    return `${code}: ${message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isManaged(target: string, state: SyncState | null): boolean {
  if (!state) {
    return false;
  }
  return Boolean(state.files[target]);
}

async function buildState(
  stateRoot: string,
  mode: "global" | "project",
  projectRoot: string | null,
  mappings: ResolvedMapping[],
  previousState: SyncState | null
): Promise<SyncState> {
  const files: Record<string, SyncRecord> = { ...(previousState?.files ?? {}) };

  for (const mapping of mappings) {
    const stat = await fs.lstat(mapping.target);
    const isLink = stat.isSymbolicLink();
    const modeValue: SyncMode = isLink ? "link" : "copy";
    const record: SyncRecord = {
      path: mapping.target,
      source: mapping.source,
      agent: mapping.agent,
      mode: modeValue,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: modeValue === "copy" ? await hashPath(mapping.target) : null,
      linkTarget: modeValue === "link" ? await readLinkTarget(mapping.target) : null
    };
    files[mapping.target] = record;
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    mode,
    projectRoot,
    files
  };
}
