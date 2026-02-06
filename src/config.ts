import fs from "fs/promises";
import path from "path";
import yaml from "yaml";
import { AgentConfigError, ExitCodes } from "./errors";
import type { AgentConfigFile, AgentConfigEntry, AgentScopeConfig, MappingFile } from "./types";

export const DEFAULT_CONFIG_FILE = "agentconfig.yml";

export function getConfigPath(root: string): string {
  return path.join(root, DEFAULT_CONFIG_FILE);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMappingFile(value: unknown): value is MappingFile {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.source === "string" && typeof value.target === "string";
}

function isAgentScopeConfig(value: unknown): value is AgentScopeConfig {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.root !== "string") {
    return false;
  }
  if (!Array.isArray(value.files)) {
    return false;
  }
  return value.files.every((entry) => isMappingFile(entry));
}

function isAgentConfigEntry(value: unknown): value is AgentConfigEntry {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.displayName !== "string") {
    return false;
  }
  if (value.global !== undefined && !isAgentScopeConfig(value.global)) {
    return false;
  }
  if (value.project !== undefined && !isAgentScopeConfig(value.project)) {
    return false;
  }
  return true;
}

function isAgentConfigFile(value: unknown): value is AgentConfigFile {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.version !== "number") {
    return false;
  }
  const defaults = value.defaults;
  if (!isRecord(defaults)) {
    return false;
  }
  if (defaults.mode !== "auto" && defaults.mode !== "link" && defaults.mode !== "copy") {
    return false;
  }
  if (typeof defaults.profile !== "string") {
    return false;
  }
  if (typeof defaults.sourceRoot !== "string") {
    return false;
  }
  const agents = value.agents;
  if (!isRecord(agents)) {
    return false;
  }
  if (!Object.values(agents).every((entry) => isAgentConfigEntry(entry))) {
    return false;
  }
  const profiles = value.profiles;
  if (profiles !== undefined) {
    if (!isRecord(profiles)) {
      return false;
    }
    for (const profile of Object.values(profiles)) {
      if (!isRecord(profile)) {
        return false;
      }
      if (profile.files !== undefined) {
        if (!Array.isArray(profile.files)) {
          return false;
        }
        if (!profile.files.every((entry) => isMappingFile(entry))) {
          return false;
        }
      }
    }
  }
  return true;
}

function formatYamlError(error: unknown, configPath: string): AgentConfigError {
  if (error instanceof Error) {
    const linePos = (error as { linePos?: Array<{ line: number; col: number }> }).linePos?.[0];
    const location = linePos ? ` (line ${linePos.line}, col ${linePos.col})` : "";
    return new AgentConfigError(
      `Invalid YAML in ${configPath}${location}: ${error.message}`,
      ExitCodes.Validation
    );
  }
  return new AgentConfigError(`Invalid YAML in ${configPath}`, ExitCodes.Validation);
}

export async function readConfig(root: string): Promise<AgentConfigFile> {
  const configPath = getConfigPath(root);
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new AgentConfigError(`Missing config: ${configPath}`, ExitCodes.Validation);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw, { prettyErrors: true });
  } catch (error) {
    throw formatYamlError(error, configPath);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AgentConfigError(`Invalid config format in ${configPath}`, ExitCodes.Validation);
  }
  if (!isAgentConfigFile(parsed)) {
    throw new AgentConfigError(`Invalid config format in ${configPath}`, ExitCodes.Validation);
  }

  return parsed;
}

export async function writeConfig(root: string, config: AgentConfigFile): Promise<void> {
  const configPath = getConfigPath(root);
  const contents = yaml.stringify(config);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(configPath, contents, "utf8");
}
