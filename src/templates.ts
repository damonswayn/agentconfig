import type { AgentConfigFile } from "./types";

export function createDefaultConfig(): AgentConfigFile {
  return {
    version: 1,
    defaults: {
      mode: "auto",
      profile: "default",
      sourceRoot: "${AGENTCONFIG_HOME:-~/.agentconfig}"
    },
    agents: {
      claude: {
        displayName: "Claude Code",
        global: {
          root: "~/.claude",
          files: [
            { source: "agent.md", target: "CLAUDE.md" },
            { source: "claude/settings.json", target: "settings.json" },
            { source: "claude/agents/", target: "agents/" },
            { source: "claude/commands/", target: "commands/" },
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "CLAUDE.md" },
            { source: "claude/settings.json", target: ".claude/settings.json" },
            { source: "claude/agents/", target: ".claude/agents/" },
            { source: "claude/commands/", target: ".claude/commands/" },
            { source: "rules/", target: ".claude/rules/" },
            { source: "skills/", target: ".claude/skills/" }
          ]
        }
      },
      codex: {
        displayName: "Codex CLI",
        global: {
          root: "${CODEX_HOME:-~/.codex}",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "skills/", target: "../.agents/skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "skills/", target: ".agents/skills/" }
          ]
        }
      },
      cursor: {
        displayName: "Cursor",
        global: {
          root: "~/.cursor",
          files: [
            { source: "cursor/hooks.json", target: "hooks.json" },
            { source: "cursor/hooks/", target: "hooks/" },
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "cursor/hooks.json", target: ".cursor/hooks.json" },
            { source: "cursor/hooks/", target: ".cursor/hooks/" },
            { source: "rules/", target: ".cursor/rules/" },
            { source: "skills/", target: ".cursor/skills/" }
          ]
        }
      },
      opencode: {
        displayName: "OpenCode",
        global: {
          root: "~/.config/opencode",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "agents/", target: "agents/" },
            { source: "commands/", target: "commands/" },
            { source: "rules/", target: "rules/" },
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "agents/", target: ".opencode/agents/" },
            { source: "commands/", target: ".opencode/commands/" },
            { source: "rules/", target: ".opencode/rules/" },
            { source: "skills/", target: ".opencode/skills/" }
          ]
        }
      }
    },
    profiles: {
      default: {
        files: []
      }
    }
  };
}
