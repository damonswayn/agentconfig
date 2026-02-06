import fs from "fs/promises";
import path from "path";
import yaml from "yaml";
import { AgentConfigError, ExitCodes } from "./errors";
import type { AgentConfigFile } from "./types";

export const DEFAULT_CONFIG_FILE = "agentconfig.yml";

export function getConfigPath(root: string): string {
  return path.join(root, DEFAULT_CONFIG_FILE);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
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

  return parsed as AgentConfigFile;
}

export async function writeConfig(root: string, config: AgentConfigFile): Promise<void> {
  const configPath = getConfigPath(root);
  const contents = yaml.stringify(config);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(configPath, contents, "utf8");
}
