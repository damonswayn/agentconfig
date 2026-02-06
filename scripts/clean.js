"use strict";

const fs = require("fs/promises");
const path = require("path");

async function run() {
  const targetArg = process.argv[2] ?? "dist";
  if (targetArg.trim().length === 0) {
    throw new Error("Clean target is empty");
  }

  const cwd = process.cwd();
  const target = path.resolve(cwd, targetArg);
  const rootWithSep = cwd.endsWith(path.sep) ? cwd : `${cwd}${path.sep}`;
  if (!target.startsWith(rootWithSep) && target !== cwd) {
    throw new Error(`Refusing to clean outside project: ${target}`);
  }

  await fs.rm(target, { recursive: true, force: true });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(message);
  process.exit(1);
});
