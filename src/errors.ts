export class AgentConfigError extends Error {
  public readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export const ExitCodes = {
  Success: 0,
  Failure: 1,
  Usage: 2,
  Validation: 3,
  Conflict: 4,
  Filesystem: 5
} as const;
