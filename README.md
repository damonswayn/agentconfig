# agentconfig

Sync a single agent config source to multiple coding agents.

## Requirements

- Node.js 20+

## Quickstart

```bash
npm install
npm run build
npm link
agentconfig init
agentconfig sync
```

## Install from npm

```bash
npm install -g agentconfig
agentconfig --help
agentconfig init
agentconfig sync
```

## Commands

- `agentconfig init` Create `agentconfig.yml` in the source root.
- `agentconfig sync` Sync configs to agent targets.
- `agentconfig status` Show drift status based on last sync.
- `agentconfig doctor` Validate config structure.
- `agentconfig list-agents` List supported agents.

## Common options

- `--project <path>` Project-only sync into a repo root.
- `--dry-run` Show actions without writing.
- `--link` Force symlink mode.
- `--copy` Force copy mode.
- `--force` Overwrite unmanaged targets (alias for `--on-conflict overwrite`).
- `--on-conflict <policy>` Choose how to handle existing unmanaged targets: `overwrite`, `backup`, `skip`, `cancel`.
- `--agent <name>` Restrict to one agent.

## Config location

Default source root is `~/.agentconfig`. Override with `AGENTCONFIG_HOME`.

## Default mappings

The default template includes common locations for agent instructions, rules, skills, and (where supported) agents, commands, and hooks.

- Claude Code hooks are synced via `claude/settings.json`, plus agents and commands via `claude/agents/` and `claude/commands/`.
- Codex skills are synced to `.agents/skills/` (global uses `${CODEX_HOME:-~/.codex}` root with a relative `../.agents/skills/`).
- Cursor hooks are synced via `cursor/hooks.json` and `cursor/hooks/`.
- OpenCode agents and commands are synced via `agents/` and `commands/`.

## Tests

```bash
npm test
```

## Linting and formatting

```bash
npm run lint
npm run format:check
npm run format
```
