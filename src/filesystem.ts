import crypto from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function readLinkTarget(target: string): Promise<string | null> {
  try {
    return await fs.readlink(target);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function hashFile(target: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on("data", (chunk) => {
      hash.update(chunk as Buffer);
    });
    stream.on("error", (error) => {
      reject(error);
    });
    stream.on("end", () => {
      resolve();
    });
  });
  return hash.digest("hex");
}

export async function listEntries(target: string): Promise<string[]> {
  return await fs.readdir(target);
}

export async function copyFileOrDir(source: string, target: string): Promise<void> {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await ensureDir(target);
    const entries = await fs.readdir(source);
    await Promise.all(
      entries.map(async (entry) => {
        const src = path.join(source, entry);
        const dest = path.join(target, entry);
        await copyFileOrDir(src, dest);
      })
    );
    return;
  }
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
}
