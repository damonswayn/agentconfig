import fs from "fs/promises";
import type { Stats } from "fs";
import { readState } from "./state";
import { hashPath, fileExists, readLinkTarget } from "./filesystem";

export interface StatusEntry {
  path: string;
  status: "missing" | "drifted" | "ok";
  reason?: string;
}

export async function getStatus(stateRoot: string): Promise<StatusEntry[]> {
  const state = await readState(stateRoot);
  if (!state) {
    return [];
  }

  const results: StatusEntry[] = [];
  for (const record of Object.values(state.files)) {
    const exists = await fileExists(record.path);
    if (!exists) {
      results.push({ path: record.path, status: "missing", reason: "target missing" });
      continue;
    }

    let stat: Stats | null = null;
    if (record.mode === "link" || record.mode === "auto") {
      stat = await fs.lstat(record.path);
    }

    const mode = record.mode === "auto" ? (stat?.isSymbolicLink() ? "link" : "copy") : record.mode;

    if (mode === "link") {
      if (!stat || !stat.isSymbolicLink()) {
        results.push({ path: record.path, status: "drifted", reason: "link target changed" });
        continue;
      }
      if (!record.linkTarget) {
        results.push({ path: record.path, status: "drifted", reason: "link target changed" });
        continue;
      }
      const linkTarget = await readLinkTarget(record.path);
      if (linkTarget !== record.linkTarget) {
        results.push({ path: record.path, status: "drifted", reason: "link target changed" });
        continue;
      }
      results.push({ path: record.path, status: "ok" });
      continue;
    }

    if (!record.hash) {
      results.push({ path: record.path, status: "drifted", reason: "content changed" });
      continue;
    }
    const currentHash = await hashPath(record.path);
    if (currentHash !== record.hash) {
      results.push({ path: record.path, status: "drifted", reason: "content changed" });
      continue;
    }
    results.push({ path: record.path, status: "ok" });
  }

  return results;
}
