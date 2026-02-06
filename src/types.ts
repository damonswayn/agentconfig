export type SyncMode = "auto" | "link" | "copy";

export interface MappingFile {
  source: string;
  target: string;
}

export interface AgentScopeConfig {
  root: string;
  files: MappingFile[];
}

export interface AgentConfigEntry {
  displayName: string;
  global?: AgentScopeConfig;
  project?: AgentScopeConfig;
}

export interface AgentConfigFile {
  version: number;
  defaults: {
    mode: SyncMode;
    profile: string;
    sourceRoot: string;
  };
  agents: Record<string, AgentConfigEntry>;
  profiles?: Record<string, { files?: MappingFile[] }>;
}

export interface ResolvedMapping {
  agent: string;
  source: string;
  target: string;
  mode: SyncMode;
}

export interface SyncRecord {
  path: string;
  source: string;
  agent: string;
  mode: SyncMode;
  size: number;
  mtimeMs: number;
  hash: string | null;
  linkTarget: string | null;
}

export interface SyncState {
  version: number;
  updatedAt: string;
  mode: "global" | "project";
  projectRoot: string | null;
  files: Record<string, SyncRecord>;
}
