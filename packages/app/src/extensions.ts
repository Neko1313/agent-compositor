import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  realpath,
  mkdir,
  mkdtemp,
  rm,
  rename,
  stat,
  cp,
  symlink,
} from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import {
  diskManifestSchema,
  claudeManifest,
  loadClaudePlugin,
  contained,
} from "@agent-compositor/loader";
import { atomicJson } from "@agent-compositor/config";
import type { CorePlugin } from "@agent-compositor/core";
import type { ToolSpec } from "@agent-compositor/tools";
import { checkout as checkoutRepo, type marketplaces } from "./marketplaces.js";
const exec = promisify(execFile);
type Installed = {
  repository: string;
  ref: string;
  commit: string;
  qualified?: string;
  path?: string;
  scope?: "user" | "project";
};
type State = { disabled: string[]; installed: Record<string, Installed> };
export async function extensionManager(
  cwd: string,
  home: string,
  stateRoot = join(cwd, ".agent-compositor"),
  market?: Awaited<ReturnType<typeof marketplaces>>,
  globalRoot = join(home, ".agent-compositor")
) {
  const files = {
    user: join(globalRoot, "extensions-state.json"),
    project: join(stateRoot, "extensions-state.json"),
  };
  const read = async (file: string): Promise<State> =>
    readFile(file, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return { disabled: [], installed: {} };
      });
  const states = {
    user: await read(files.user),
    project: await read(files.project),
  };
  let busy = false;
  for (const [name, entry] of Object.entries(states.project.installed)) {
    if (
      !entry.scope &&
      (await stat(join(globalRoot, "plugins", name)).catch(() => undefined))
    ) {
      states.user.installed[name] ??= { ...entry, scope: "user" };
      delete states.project.installed[name];
      await atomicJson(files.user, states.user);
      await atomicJson(files.project, states.project);
    }
  }

  const installed = () => ({
    ...states.user.installed,
    ...states.project.installed,
  });
  const disabled = () => [
    ...new Set([...states.user.disabled, ...states.project.disabled]),
  ];
  async function catalog() {
    const entries: any[] = [];
    for (const file of [
      join(globalRoot, "extensions.json"),
      join(cwd, ".agent-compositor/extensions.json"),
    ]) {
      try {
        const rows = JSON.parse(await readFile(file, "utf8"));
        if (!Array.isArray(rows))
          throw Error("Extension catalog must be an array");
        entries.push(...rows);
      } catch (e) {
        if ((e as any).code !== "ENOENT") throw e;
      }
    }
    return [...new Map(entries.map((row) => [row.name, row])).values()];
  }
  async function control(args: any, signal: AbortSignal) {
    if (args.action === "list")
      return {
        catalog: await catalog(),
        installed: installed(),
        disabled: disabled(),
        reload: "Use /reload after changes",
      };
    const qualified = args.name?.includes("@")
        ? args.name
        : installed()[args.name]?.qualified ?? args.name,
      name = String(args.name ?? "").split("@")[0];
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name))
      throw Error("Invalid extension name");
    const known = installed()[name];
    const scope: "user" | "project" =
      args.scope ??
      (["enable", "disable"].includes(args.action)
        ? "project"
        : known?.scope ?? "user");
    if (!["user", "project"].includes(scope))
      throw Error("Invalid extension scope");
    if (busy) throw Error("Another extension operation is in progress");
    busy = true;
    try {
      states[scope] = await read(files[scope]);
      const state = states[scope];
      const dir =
        scope === "user"
          ? join(globalRoot, "plugins")
          : join(cwd, ".agent-compositor/plugins");
      if (["enable", "disable"].includes(args.action)) {
        state.disabled = state.disabled.filter((n) => n !== name);
        if (args.action === "disable") state.disabled.push(name);
        await atomicJson(files[scope], state);
        return { changed: name, scope, reloadRequired: true };
      }
      await mkdir(dir, { recursive: true });
      const backup = async () => {
        const destination = join(
          globalRoot,
          "extension-backups",
          `${name}-${Date.now()}`
        );
        await mkdir(join(globalRoot, "extension-backups"), { recursive: true });
        await rename(join(dir, name), destination);
        return destination;
      };
      if (args.action === "remove") {
        if (!state.installed[name])
          throw Error("Only managed extensions in this scope can be removed");
        const saved = await backup();
        delete state.installed[name];
        await atomicJson(files[scope], state);
        return { removed: name, scope, backup: saved, reloadRequired: true };
      }
      if (!["install", "update"].includes(args.action))
        throw Error("Invalid extension action");
      const entry: any =
        (qualified?.includes("@")
          ? await market?.source(qualified)
          : undefined) ??
        (await catalog()).find((r) => r.name === name) ??
        known;
      if (!entry) throw Error("Extension is not in the configured catalog");
      const ref = String(args.ref ?? entry.ref ?? "");
      if (!ref) throw Error("Explicit valid ref is required");
      const temp = await mkdtemp(join(dir, ".install-")),
        checkout = join(temp, "checkout");
      try {
        let commit: string;
        if (entry.directory) {
          await cp(entry.directory, checkout, {
            recursive: true,
            dereference: false,
          });
          commit = "local";
        } else
          commit = await checkoutRepo(
            String(entry.repository),
            ref,
            checkout,
            signal
          );
        const source = entry.path
          ? await contained(checkout, entry.path)
          : checkout;
        let manifest;
        try {
          manifest = diskManifestSchema.parse(
            JSON.parse(await readFile(join(source, "plugin.json"), "utf8"))
          );
        } catch (e) {
          if ((e as any).code !== "ENOENT") throw e;
          manifest = await claudeManifest(source);
          await loadClaudePlugin(source);
        }
        if (manifest.name !== name)
          throw Error("Catalog name does not match manifest");
        if (args.dependencies) {
          if (
            !(await stat(join(source, "package-lock.json")).catch(
              () => undefined
            ))
          )
            throw Error("Dependency installation requires package-lock.json");
          await exec(
            "npm",
            ["ci", "--workspaces=false", "--omit=dev", "--ignore-scripts"],
            { cwd: source, signal, timeout: 120000, maxBuffer: 1000000 }
          );
        }
        // Runtime API packages are supplied by the installed host, even when the
        // extension lives outside its node_modules ancestry.
        if (await stat(join(source, "plugin.json")).catch(() => undefined)) {
          const namespace = join(source, "node_modules/@agent-compositor");
          for (const part of ["node_modules", "node_modules/@agent-compositor"])
            if (await stat(join(source, part)).catch(() => undefined))
              await contained(source, part);
          await mkdir(namespace, { recursive: true });
          const executableDir = dirname(await realpath(process.execPath));
          const distribution = await stat(join(executableDir, "node_modules/@agent-compositor")).catch(() => undefined);
          const require = createRequire(distribution ? join(executableDir, "package.json") : import.meta.url);
          for (const api of [
            "events",
            "hooks",
            "tools",
            "config",
            "protocol",
            "runtime",
            "core",
            "provider",
            "session",
            "skills",
            "loader",
            "plugins",
          ]) {
            const target = join(namespace, api);
            if (await stat(target).catch(() => undefined)) continue;
            const entry = require.resolve(`@agent-compositor/${api}`);
            let packageRoot = dirname(entry);
            while (!await stat(join(packageRoot, "package.json")).catch(() => undefined)) {
              const parent = dirname(packageRoot);
              if (parent === packageRoot) throw new Error(`Host package not found: ${api}`);
              packageRoot = parent;
            }
            await symlink(packageRoot, target, "dir");
          }
        }
        const previous = await stat(join(dir, name)).catch(() => undefined);
        const saved = previous ? await backup() : undefined;
        try {
          await rename(source, join(dir, name));
        } catch (e) {
          if (saved) await rename(saved, join(dir, name));
          throw e;
        }
        state.installed[name] = {
          repository: entry.repository,
          ref,
          commit,
          scope,
          ...(qualified?.includes("@") ? { qualified } : {}),
          ...(entry.path ? { path: entry.path } : {}),
        };
        await atomicJson(files[scope], state);
        return {
          name,
          version: manifest.version,
          trust: manifest.trust,
          commit,
          scope,
          reloadRequired: true,
        };
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    } finally {
      busy = false;
    }
  }
  const tool: ToolSpec = {
    name: "extension_control",
    description:
      "List/install/update/enable/disable/remove managed extensions. Supports plugin@marketplace and user/project scopes. Changes require /reload. Optional dependencies use lockfiles without package scripts.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "install", "update", "enable", "disable", "remove"],
        },
        name: { type: "string" },
        ref: { type: "string" },
        scope: { type: "string", enum: ["user", "project"] },
        dependencies: { type: "boolean" },
      },
      required: ["action"],
    },
    describe: (a: any) => ({
      tool: a.action === "list" ? "extension_list" : "extension_control",
      command: [a.action, a.name ?? "", a.ref ?? ""],
    }),
    execute: async (ctx, args) => {
      try {
        return { ok: true, data: await control(args, ctx.signal) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  };
  const plugin: CorePlugin = {
    manifest: { name: "extension-manager", version: "1.0.0", trust: "trusted" },
    hooks: {
      "prompt.submit": async (e, $) => {
        const words = e.text.trim().split(/\s+/),
          [command, action = "list", name, ref] = words.filter(
            (word: string) => !word.startsWith("--")
          );
        if (command !== "/extensions") return;
        const scope = words.includes("--project")
          ? "project"
          : words.includes("--user")
          ? "user"
          : undefined;
        const result = await $.agent.tool("extension_control", {
          action,
          name,
          ref,
          scope,
          dependencies: words.includes("--dependencies"),
        });
        await $.ui.surface(
          "extensions",
          "Extensions",
          JSON.stringify(result, null, 2),
          { site: "inspector" }
        );
        return { drop: "extension-manager: handled" };
      },
    },
  };
  return { tool, plugin, disabled };
}
