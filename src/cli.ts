import fs from "fs/promises";
import { AgentConfigError, ExitCodes } from "./errors";
import type { SyncMode } from "./types";
import { getConfigPath, readConfig, writeConfig } from "./config";
import { createDefaultConfig } from "./templates";
import { getStatus } from "./status";
import { syncConfigs } from "./sync";
import { resolvePath } from "./paths";

type Command = "init" | "sync" | "status" | "doctor" | "list-agents";

interface ParsedArgs {
  command: Command | null;
  project?: string;
  dryRun: boolean;
  mode: SyncMode | null;
  force: boolean;
  conflictPolicy?: "overwrite" | "backup" | "skip" | "cancel";
  agent?: string;
  strict: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: null,
    dryRun: false,
    mode: null,
    force: false,
    strict: false,
    help: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!result.command && !arg.startsWith("-")) {
      result.command = arg as Command;
      continue;
    }
    if (arg === "--project") {
      result.project = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--link") {
      result.mode = "link";
      continue;
    }
    if (arg === "--copy") {
      result.mode = "copy";
      continue;
    }
    if (arg === "--force") {
      result.force = true;
      continue;
    }
    if (arg === "--on-conflict") {
      const value = args[i + 1];
      if (value === "overwrite" || value === "backup" || value === "skip" || value === "cancel") {
        result.conflictPolicy = value;
      }
      i += 1;
      continue;
    }
    if (arg === "--agent") {
      result.agent = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--strict") {
      result.strict = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
  }

  return result;
}

function printHelp(): void {
  const lines = [
    "agentconfig <command> [options]",
    "",
    "Commands:",
    "  init        Create agentconfig.yml in source root",
    "  sync        Sync configs to agents",
    "  status      Show drift status",
    "  doctor      Validate config and paths",
    "  list-agents List supported agents",
    "",
    "Options:",
    "  --project <path>  Use project mode and root",
    "  --dry-run         Show actions without writing",
    "  --link            Force symlink mode",
    "  --copy            Force copy mode",
    "  --force           Overwrite unmanaged targets (alias for --on-conflict overwrite)",
    "  --on-conflict <policy>  overwrite | backup | skip | cancel",
    "  --agent <name>    Filter to one agent",
    "  --strict          Error on missing source files (default: skip)",
    "  -h, --help        Show help"
  ];
  console.log(lines.join("\n"));
}

function ensureSourceRoot(): string {
  const envRoot = process.env.AGENTCONFIG_HOME;
  if (envRoot && envRoot.length > 0) {
    return resolvePath(envRoot, process.env);
  }
  return resolvePath("~/.agentconfig", process.env);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  const sourceRoot = ensureSourceRoot();

  switch (args.command) {
    case "init": {
      const configPath = getConfigPath(sourceRoot);
      const exists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        throw new AgentConfigError(`Config already exists: ${configPath}`, ExitCodes.Conflict);
      }
      await writeConfig(sourceRoot, createDefaultConfig());
      console.log(`Created ${configPath}`);
      return;
    }
    case "sync": {
      const config = await readConfig(sourceRoot);
      const mode = args.project ? "project" : "global";
      const projectRoot = args.project ? resolvePath(args.project, process.env) : null;
      const linkMode = args.mode ?? config.defaults.mode;
      const result = await syncConfigs({
        config,
        sourceRoot,
        mode,
        projectRoot,
        linkMode,
        dryRun: args.dryRun,
        force: args.force,
        conflictPolicy: args.conflictPolicy ?? (args.force ? "overwrite" : undefined),
        agentFilter: args.agent,
        strict: args.strict
      });
      result.warnings.forEach((warning) => console.warn(warning));
      console.log(`Planned: ${result.planned.length}`);
      console.log(`Updated: ${result.updated.length}`);
      console.log(`Skipped: ${result.skipped.length}`);
      return;
    }
    case "status": {
      const entries = await getStatus(sourceRoot);
      if (entries.length === 0) {
        console.log("No sync state found.");
        return;
      }
      const drifted = entries.filter((entry) => entry.status !== "ok");
      entries.forEach((entry) => {
        const suffix = entry.reason ? ` (${entry.reason})` : "";
        console.log(`${entry.status}: ${entry.path}${suffix}`);
      });
      if (drifted.length > 0) {
        process.exitCode = ExitCodes.Validation;
      }
      return;
    }
    case "doctor": {
      const config = await readConfig(sourceRoot);
      if (!config.defaults || !config.agents) {
        throw new AgentConfigError("Config missing defaults or agents", ExitCodes.Validation);
      }
      console.log("Config OK");
      return;
    }
    case "list-agents": {
      const config = await readConfig(sourceRoot);
      const agents = Object.entries(config.agents);
      agents.forEach(([name, entry]) => {
        console.log(`${name}: ${entry.displayName}`);
      });
      return;
    }
    default:
      throw new AgentConfigError(`Unknown command: ${String(args.command)}`, ExitCodes.Usage);
  }
}

run().catch((error: unknown) => {
  if (error instanceof AgentConfigError) {
    console.error(error.message);
    process.exit(error.code);
  }
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exit(ExitCodes.Failure);
});
