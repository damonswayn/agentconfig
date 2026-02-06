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
- `--force` Overwrite unmanaged targets.
- `--agent <name>` Restrict to one agent.

## Config location

Default source root is `~/.agentconfig`. Override with `AGENTCONFIG_HOME`.

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
