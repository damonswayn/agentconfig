import os from "os";
import path from "path";

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function expandEnv(inputPath: string, env: NodeJS.ProcessEnv): string {
  const resolved = inputPath.replace(
    /\$\{([A-Z0-9_]+)(:-([^}]*))?\}/gi,
    (
      _match: string,
      varName: string,
      _fallbackGroup: string | undefined,
      fallback: string | undefined
    ): string => {
      const value = env[varName];
      if (value && value.length > 0) {
        return value;
      }
      if (fallback !== undefined) {
        return fallback;
      }
      return "";
    }
  );
  return resolved;
}

export function resolvePath(inputPath: string, env: NodeJS.ProcessEnv): string {
  const expanded = expandHome(expandEnv(inputPath, env));
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(expanded);
}

export function resolveFromRoot(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return path.resolve(relativePath);
  }
  return path.resolve(path.join(root, relativePath));
}
