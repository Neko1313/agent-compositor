import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ConfigSource } from "./schema.js";

/** Config file names, any of them may exist at a level. */
export const CONFIG_NAMES = [
  "agent-compositor.json",
  "agent-compositor.jsonc",
] as const;

/** Directory name holding per-project config and plugins (like `.opencode/`). */
export const PROJECT_DIR = ".agent-compositor";

export interface DiscoveryOptions {
  cwd?: string;
  /** Limit project layers when defaults were inherited from a parent agent. */
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** disable the system layer (tests, portable runs) */
  system?: boolean;
  /** disable the global layer */
  global?: boolean;
}

/** Platform system config directory: /etc/agent-compositor on Linux. */
export function systemDirectory(
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "darwin")
    return "/Library/Application Support/agent-compositor";
  if (platform === "win32")
    return path.join(
      process.env.ProgramData || "C:\\ProgramData",
      "agent-compositor"
    );
  return "/etc/agent-compositor";
}

export function globalDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32")
    return path.join(
      env.APPDATA || path.join(os.homedir(), "AppData/Roaming"),
      "agent-compositor"
    );
  return path.join(
    env.XDG_CONFIG_HOME || path.join(env.HOME ?? os.homedir(), ".config"),
    "agent-compositor"
  );
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Discover config sources, farthest from the user first:
 *   system dir → global dir → project walk from filesystem root down to cwd.
 *
 * At every directory level of the project walk both `agent-compositor.json(c)`
 * and `<dir>/.agent-compositor/agent-compositor.json(c)` are eligible, so a
 * monorepo contributes from each ancestor (closest wins at merge time).
 * Global/system roots are resolved and excluded from the project walk, so a
 * session started inside the config directory never double-counts them.
 */
export async function discover(
  options: DiscoveryOptions = {}
): Promise<ConfigSource[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const sources: ConfigSource[] = [];

  const systemRoot = path.resolve(
    options.system === false ? "" : systemDirectory()
  );
  const globalRoot = path.resolve(globalDirectory(env));

  if (options.system !== false)
    sources.push({
      layer: "system",
      path: systemRoot,
      present: await isDir(systemRoot),
    });

  if (options.global !== false) {
    const homeRoot = path.join(
      env.AGENT_HOME ?? path.join(env.HOME ?? os.homedir(), ".agent-compositor")
    );
    if (
      homeRoot !== globalRoot &&
      (await isFile(path.join(homeRoot, "agent-compositor.json")))
    )
      sources.push({ layer: "global", path: homeRoot, present: true });
  }
  if (options.global !== false)
    sources.push({
      layer: "global",
      path: globalRoot,
      present: await isDir(globalRoot),
    });

  // level configs inside system/global roots (e.g. ~/.config/agent-compositor/agent-compositor.json)
  const staticRoots = [systemRoot, globalRoot];

  // build the ancestor chain root → cwd
  const ancestors: string[] = [];
  for (let dir = cwd; ; ) {
    ancestors.unshift(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let depth = ancestors.length - 1;
  for (const dir of ancestors) {
    if (
      options.projectRoot &&
      dir !== path.resolve(options.projectRoot) &&
      !dir.startsWith(path.resolve(options.projectRoot) + path.sep)
    ) {
      depth--;
      continue;
    }
    if (
      staticRoots.some(
        (root) => dir === root || dir.startsWith(root + path.sep)
      )
    ) {
      depth--;
      continue; // global/static roots never re-enter through the project walk
    }
    for (const name of CONFIG_NAMES) {
      const file = path.join(dir, name);
      if (await isFile(file))
        sources.push({ layer: "project", path: file, present: true, depth });
    }
    const projectDir = path.join(dir, PROJECT_DIR);
    if (await isDir(projectDir)) {
      for (const name of CONFIG_NAMES) {
        const file = path.join(projectDir, name);
        if (await isFile(file))
          sources.push({ layer: "project", path: file, present: true, depth });
      }
    }
    depth--;
  }

  return sources;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}
