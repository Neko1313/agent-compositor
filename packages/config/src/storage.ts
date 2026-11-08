import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  cp,
  readdir,
  lstat,
  realpath,
} from "node:fs/promises";
import {
  join,
  resolve,
  basename,
  relative,
  isAbsolute,
  dirname,
  sep,
} from "node:path";
import { homedir } from "node:os";
export function storagePaths(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
) {
  let project = resolve(cwd);
  try {
    project = realpathSync(project);
  } catch {}
  const home = env.AGENT_HOME
    ? resolve(env.AGENT_HOME)
    : join(env.HOME ?? env.USERPROFILE ?? homedir(), ".agent-compositor");
  const id = `${
    basename(project).replace(/[^\w.-]/g, "_") || "root"
  }-${createHash("sha256").update(project).digest("hex").slice(0, 16)}`;
  const state =
    env.AGENT_STORAGE_MODE === "project"
      ? join(project, ".agent-compositor")
      : join(home, "projects", id);
  return {
    home,
    project,
    id,
    state,
    config: join(project, ".agent-compositor"),
    sessions: join(state, "sessions"),
  };
}
export async function atomicJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
/** Global defaults, shared project settings, then private local preferences. */
export async function readSettings(
  cwd: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  inherited?: Record<string, unknown>
): Promise<any> {
  if (!/^[\w.-]+$/.test(name)) throw Error("Invalid settings filename");
  const p = storagePaths(cwd, env);
  let value: any = {};
  for (const root of [...new Set([p.home, p.config, p.state])]) {
    try {
      const next = JSON.parse(await readFile(join(root, name), "utf8"));
      if (!next || typeof next !== "object" || Array.isArray(next))
        throw Error("Settings must be an object");
      value = mergeSettings(value, next);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (root === p.home && inherited)
      value = mergeSettings(value, structuredClone(inherited));
  }
  return value;
}
export function mergeSettings(a: any, b: any): any {
  for (const [key, value] of Object.entries(b)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    a[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeSettings(
            a[key] && typeof a[key] === "object" ? a[key] : {},
            value
          )
        : value;
  }
  return a;
}
export class ProjectStorage {
  inheritedSettings?: (name: string) => Promise<any>;
  contributions: Record<string, any> = {};
  paths: ReturnType<typeof storagePaths>;
  constructor(cwd: string, public env: NodeJS.ProcessEnv = process.env) {
    this.paths = storagePaths(cwd, env);
  }
  async init() {
    const p = this.paths;
    await mkdir(p.state, { recursive: true, mode: 0o700 });
    const marker = join(p.state, "project.json");
    try {
      await readFile(marker);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Copy, never delete old data. A completed marker prevents stale reimports.
    if (p.state !== p.config)
      for (const name of [
        "sessions",
        "todos.json",
        "agents.json",
        "layout.json",
        "model.json",
        "input-history.json",
        "checkpoints.json",
        "turn-checkpoints",
        "memory.md",
        "workflows",
        "callix-cache.json",
        "extensions-state.json",
      ]) {
        const from = join(p.config, name),
          to = join(p.state, name);
        try {
          if ((await lstat(from)).isSymbolicLink()) continue;
          await cp(from, to, {
            recursive: true,
            force: false,
            errorOnExist: false,
          });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    try {
      await cp(join(p.project, "COMPOSITOR.md"), join(p.state, "memory.md"), {
        force: false,
        errorOnExist: false,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await atomicJson(marker, {
      version: 1,
      id: p.id,
      cwd: p.project,
      migratedAt: new Date().toISOString(),
    });
  }
  async config(name: string) {
    return mergeSettings(
      structuredClone(this.contributions[name] ?? {}),
      await readSettings(
        this.paths.project,
        name,
        this.env,
        await this.inheritedSettings?.(name)
      )
    );
  }
  async safe(root: string, key: string) {
    if (
      !key ||
      isAbsolute(key) ||
      key.split(/[\\/]/).some((part) => part === "..") ||
      key.includes("\0")
    )
      throw Error("Storage path escapes scope");
    const abs = resolve(root, key);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonical = await realpath(root);
    let ancestor = abs;
    while (true) {
      try {
        const actual = await realpath(ancestor),
          rel = relative(canonical, actual);
        if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
          throw Error("Storage symlink escapes scope");
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        ancestor = dirname(ancestor);
      }
    }
    return abs;
  }
  scope(plugin: string, scope = "project", session = "") {
    if (
      !/^[\w.-]+$/.test(plugin) ||
      !["project", "global", "session", "cache"].includes(scope)
    )
      throw Error("Invalid storage scope");
    if (scope === "session" && !/^[\w.-]+$/.test(session))
      throw Error("Invalid session id");
    return scope === "global"
      ? join(this.paths.home, "plugin-state", plugin)
      : scope === "cache"
      ? join(this.paths.state, "cache", plugin)
      : scope === "session"
      ? join(this.paths.state, "session-state", session, plugin)
      : join(this.paths.state, "plugin-state", plugin);
  }
  async read(plugin: string, key: string, scope = "project", session = "") {
    return JSON.parse(
      await readFile(
        await this.safe(this.scope(plugin, scope, session), key + ".json"),
        "utf8"
      )
    );
  }
  async write(
    plugin: string,
    key: string,
    value: unknown,
    scope = "project",
    session = ""
  ) {
    await atomicJson(
      await this.safe(this.scope(plugin, scope, session), key + ".json"),
      value
    );
  }
  async legacyRead(path: string) {
    const key = path.replace(/^\.agent-compositor[\\/]/, "");
    for (const root of [
      ...new Set([this.paths.state, this.paths.config, this.paths.home]),
    ])
      try {
        return await readFile(await this.safe(root, key), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    throw Object.assign(Error(`Missing state: ${key}`), { code: "ENOENT" });
  }
  async legacyWrite(path: string, content: string) {
    const file = await this.safe(
      this.paths.state,
      path.replace(/^\.agent-compositor[\\/]/, "")
    );
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, file);
  }
}
