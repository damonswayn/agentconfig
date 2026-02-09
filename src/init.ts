import fs from "fs/promises";
import path from "path";
import { AgentConfigError, ExitCodes } from "./errors";
import { fileExists, ensureDir } from "./filesystem";
import { resolveFromRoot } from "./paths";
import { getConfigPath, writeConfig } from "./config";
import { createDefaultConfig } from "./templates";
import type { AgentConfigFile, ConflictPolicy, MappingFile } from "./types";

function isDirectoryMapping(source: string): boolean {
  return source.endsWith("/") || source.endsWith(path.sep);
}

function collectMappings(config: AgentConfigFile): MappingFile[] {
  const mappings: MappingFile[] = [];
  for (const agentConfig of Object.values(config.agents)) {
    if (agentConfig.global) {
      mappings.push(...agentConfig.global.files);
    }
    if (agentConfig.project) {
      mappings.push(...agentConfig.project.files);
    }
  }

  for (const profile of Object.values(config.profiles ?? {})) {
    if (profile.files) {
      mappings.push(...profile.files);
    }
  }

  return mappings;
}

export async function ensureSourceDirectories(
  config: AgentConfigFile,
  sourceRoot: string
): Promise<void> {
  const mappings = collectMappings(config);
  const sources = new Set<string>();
  for (const mapping of mappings) {
    sources.add(mapping.source);
  }

  await Promise.all(
    Array.from(sources).map(async (source) => {
      const resolved = resolveFromRoot(sourceRoot, source);
      if (isDirectoryMapping(source)) {
        await ensureDir(resolved);
        return;
      }
      await ensureDir(path.dirname(resolved));
    })
  );
}

async function backupConfig(configPath: string, sourceRoot: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(sourceRoot, "backup", timestamp);
  const relativeTarget = path.relative(sourceRoot, configPath);
  const destination = path.join(backupRoot, relativeTarget);
  await ensureDir(path.dirname(destination));
  await fs.copyFile(configPath, destination);
}

export interface InitOptions {
  config?: AgentConfigFile;
  conflictPolicy?: ConflictPolicy;
  force?: boolean;
}

export async function initConfig(
  sourceRoot: string,
  options: InitOptions = {}
): Promise<{ action: "created" | "overwritten" | "skipped"; configPath: string }> {
  const configPath = getConfigPath(sourceRoot);
  const exists = await fileExists(configPath);
  const config = options.config ?? createDefaultConfig();
  const policy = options.conflictPolicy ?? (options.force ? "overwrite" : null);

  if (exists) {
    if (!policy) {
      throw new AgentConfigError(`Config already exists: ${configPath}`, ExitCodes.Conflict);
    }
    if (policy === "skip") {
      return { action: "skipped", configPath };
    }
    if (policy === "cancel") {
      throw new AgentConfigError("Init cancelled", ExitCodes.Conflict);
    }
    if (policy === "backup") {
      await backupConfig(configPath, sourceRoot);
    }
  }

  await writeConfig(sourceRoot, config);
  await ensureSourceDirectories(config, sourceRoot);

  return { action: exists ? "overwritten" : "created", configPath };
}
