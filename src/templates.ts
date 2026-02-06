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
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "CLAUDE.md" },
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
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
            { source: "skills/", target: ".codex/skills/" }
          ]
        }
      },
      cursor: {
        displayName: "Cursor",
        global: {
          root: "~/.cursor",
          files: [{ source: "skills/", target: "skills/" }]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
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
            { source: "rules/", target: "rules/" },
            { source: "skills/", target: "skills/" }
          ]
        },
        project: {
          root: "<project-root>",
          files: [
            { source: "agent.md", target: "AGENTS.md" },
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
