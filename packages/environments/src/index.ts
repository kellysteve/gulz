import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, release } from "node:os";
import { delimiter, join } from "node:path";

export type EnvironmentKind = "termux" | "linux" | "macos" | "windows" | "unknown";
export interface EnvironmentInfo {
  kind: EnvironmentKind;
  platform: string;
  architecture: string;
  osRelease: string;
  nodeVersion: string;
  workingDirectory: string;
  isTermux: boolean;
  packageManagers: string[];
  developerTools: string[];
}
export interface EnvironmentDetectionOptions {
  platform?: string;
  architecture?: string;
  osRelease?: string;
  nodeVersion?: string;
  workingDirectory?: string;
  env?: NodeJS.ProcessEnv;
}
const packageManagerNames = ["pkg", "apt-get", "apt", "dnf", "yum", "pacman", "apk", "brew", "winget", "choco", "scoop"] as const;
const developerToolNames = ["node", "npm", "pnpm", "yarn", "python", "python3", "pip", "pip3", "git", "docker", "podman", "systemctl", "ssh"] as const;

async function hasExecutable(name: string, pathValue: string, pathext: string, platform: string): Promise<boolean> {
  const extensions = platform === "win32" ? ["", ...pathext.split(";").filter(Boolean)] : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      try {
        await access(join(directory, name + extension), constants.F_OK | (platform === "win32" ? 0 : constants.X_OK));
        return true;
      } catch {
        // Continue through PATH entries; do not execute candidate programs.
      }
    }
  }
  return false;
}

/** Detects the current runtime without executing commands or exposing environment secrets. */
export async function detectEnvironment(options: EnvironmentDetectionOptions = {}): Promise<EnvironmentInfo> {
  const env = options.env ?? process.env;
  const currentPlatform = options.platform ?? process.platform;
  const termux = Boolean(env.TERMUX_VERSION || env.PREFIX?.includes("/com.termux/") || env.PREFIX?.endsWith("/com.termux"));
  const kind: EnvironmentKind = termux ? "termux" : currentPlatform === "linux" ? "linux" : currentPlatform === "darwin" ? "macos" : currentPlatform === "win32" ? "windows" : "unknown";
  const pathValue = env.PATH ?? env.Path ?? "";
  const pathext = env.PATHEXT ?? ".EXE;.CMD;.BAT";
  const [packageManagers, developerTools] = await Promise.all([
    Promise.all(packageManagerNames.map(async (name) => await hasExecutable(name, pathValue, pathext, currentPlatform) ? name : null)),
    Promise.all(developerToolNames.map(async (name) => await hasExecutable(name, pathValue, pathext) ? name : null)),
  ]);
  return {
    kind,
    platform: currentPlatform,
    architecture: options.architecture ?? arch(),
    osRelease: options.osRelease ?? release(),
    nodeVersion: options.nodeVersion ?? process.version,
    workingDirectory: options.workingDirectory ?? process.cwd(),
    isTermux: termux,
    packageManagers: packageManagers.filter((name): name is string => name !== null),
    developerTools: developerTools.filter((name): name is string => name !== null),
  };
}
