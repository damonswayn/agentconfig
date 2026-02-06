import fs from "fs/promises";
import path from "path";
import { AgentConfigError, ExitCodes } from "./errors";
import type { SyncState } from "./types";

const STATE_FILE = ".sync-state.json";

export function getStatePath(root: string): string {
  return path.join(root, STATE_FILE);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readState(root: string): Promise<SyncState | null> {
  const statePath = getStatePath(root);
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as SyncState;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new AgentConfigError(
        `Invalid JSON in ${statePath}: ${error.message}`,
        ExitCodes.Validation
      );
    }
    throw error;
  }
}

export async function writeState(root: string, state: SyncState): Promise<void> {
  const statePath = getStatePath(root);
  const contents = JSON.stringify(state, null, 2);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(statePath, contents, "utf8");
}
