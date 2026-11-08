import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { z } from "zod";
import { atomicJson } from "@agent-compositor/config";
import { contained } from "@agent-compositor/loader";
const exec = promisify(execFile);
const name = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
export const marketplaceSchema = z
  .object({
    name,
    owner: z
      .object({ name: z.string(), email: z.string().optional() })
      .passthrough(),
    plugins: z.array(
      z
        .object({
          name,
          description: z.string().optional(),
          version: z.string().optional(),
          source: z.union([
            z.string(),
            z
              .object({
                source: z.enum(["github", "url"]),
                repo: z.string().optional(),
                url: z.string().optional(),
                ref: z.string().optional(),
                sha: z
                  .string()
                  .regex(/^[a-f0-9]{40}$/)
                  .optional(),
                path: z.string().optional(),
              })
              .passthrough(),
          ]),
        })
        .passthrough()
    ),
  })
  .passthrough()
  .superRefine((m, ctx) => {
    if (new Set(m.plugins.map((p) => p.name)).size !== m.plugins.length)
      ctx.addIssue({ code: "custom", message: "Duplicate plugin names" });
  });
export async function checkout(
  repository: string,
  ref: string,
  target: string,
  signal: AbortSignal
) {
  if (!isAbsolute(repository)) {
    const url = new URL(repository);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("Repositories require credential-free HTTPS");
  }
  if (!ref || ref.startsWith("-") || !/^[\w./-]+$/.test(ref))
    throw Error("Invalid Git ref");
  const opts = {
    cwd: target,
    signal,
    timeout: 120000,
    maxBuffer: 1000000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ALLOW_PROTOCOL: "https:file",
    },
  };
  await mkdir(target, { recursive: true });
  await exec("git", ["init", "--quiet"], opts);
  await exec(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "fetch",
      "--depth",
      "1",
      "--no-recurse-submodules",
      "--",
      repository,
      ref,
    ],
    opts
  );
  await exec(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "checkout",
      "--detach",
      "--quiet",
      "FETCH_HEAD",
    ],
    opts
  );
  return (await exec("git", ["rev-parse", "HEAD"], opts)).stdout.trim();
}
type Registration = {
  source: string;
  ref: string;
  commit?: string;
  root?: string;
  name?: string;
  scope: "user" | "project";
};
export async function marketplaces(
  cwd: string,
  home: string,
  stateDir: string,
  globalRoot = join(home, ".agent-compositor")
) {
  const globalFile = join(globalRoot, "marketplaces.json"),
    projectFile = join(cwd, ".agent-compositor/marketplaces.json");
  const read = async (file: string): Promise<Record<string, Registration>> =>
    readFile(file, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return {};
      });
  const registrations = async () => ({
    ...(await read(globalFile)),
    ...(await read(projectFile)),
  });
  const catalog = async (reg: Registration) => {
    if (!reg.root) {
      if (isAbsolute(reg.source) || reg.source.startsWith(".")) {
        reg.root = await realpath(resolve(cwd, reg.source));
        if (reg.root.endsWith(".json")) reg.root = dirname(dirname(reg.root));
      } else {
        if (!reg.commit || !reg.name)
          throw Error(
            "A shared Git registration requires name and pinned commit"
          );
        reg.root = join(
          globalRoot,
          "marketplace-cache",
          `${reg.name}-${reg.commit}`
        );
        if (!(await realpath(reg.root).catch(() => undefined))) {
          const temp = await mkdtemp(join(globalRoot, ".marketplace-"));
          try {
            await checkout(
              reg.source,
              reg.commit,
              join(temp, "checkout"),
              AbortSignal.timeout(120000)
            );
            await mkdir(join(globalRoot, "marketplace-cache"), {
              recursive: true,
            });
            await rename(join(temp, "checkout"), reg.root);
          } finally {
            await rm(temp, { recursive: true, force: true });
          }
        }
      }
    }
    return marketplaceSchema.parse(
      JSON.parse(
        await readFile(
          join(reg.root, ".claude-plugin/marketplace.json"),
          "utf8"
        )
      )
    );
  };
  async function add(
    source: string,
    ref: string,
    scope: "user" | "project",
    signal: AbortSignal,
    expected?: string
  ) {
    if (!source) throw Error("Marketplace source is required");
    let root: string, commit: string | undefined, temp: string | undefined;
    if (isAbsolute(source) || source.startsWith(".")) {
      root = await realpath(resolve(cwd, source));
      if (root.endsWith(".json")) root = dirname(dirname(root));
    } else {
      if (/^[\w.-]+\/[\w.-]+$/.test(source))
        source = `https://github.com/${source}.git`;
      const base = join(globalRoot, "marketplace-cache");
      await mkdir(base, { recursive: true });
      temp = await mkdtemp(join(base, ".fetch-"));
      root = join(temp, "checkout");
      commit = await checkout(source, ref, root, signal);
    }
    try {
      const parsed = await catalog({ source, ref, root, commit, scope });
      if (expected && parsed.name !== expected)
        throw Error("Marketplace identity changed");
      if (temp) {
        const final = join(
          globalRoot,
          "marketplace-cache",
          `${parsed.name}-${commit}`
        );
        try {
          await rename(root, final);
        } catch (e) {
          if (!["EEXIST", "ENOTEMPTY"].includes((e as any).code)) throw e;
        }
        root = final;
      }
      const file = scope === "project" ? projectFile : globalFile,
        existing = await read(file);
      existing[parsed.name] = {
        source,
        ref,
        commit,
        name: parsed.name,
        ...(scope === "user" ? { root } : {}),
        scope,
      };
      await atomicJson(file, existing);
      return {
        name: parsed.name,
        plugins: parsed.plugins.map((p) => p.name),
        commit,
        scope,
      };
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
  async function control(args: any, signal: AbortSignal) {
    if (args.action === "add")
      return add(
        args.source,
        args.ref ?? "HEAD",
        args.scope === "project" ? "project" : "user",
        signal
      );
    const rows = await registrations();
    if (args.action === "list")
      return Promise.all(
        Object.entries(rows).map(async ([name, r]) => ({
          name,
          ...r,
          plugins: (await catalog(r)).plugins,
        }))
      );
    const reg = rows[args.name];
    if (!reg) throw Error("Unknown marketplace");
    if (args.action === "update")
      return add(reg.source, reg.ref, reg.scope, signal, args.name);
    if (args.action === "remove") {
      const file = reg.scope === "project" ? projectFile : globalFile,
        existing = await read(file);
      delete existing[args.name];
      await atomicJson(file, existing);
      return { removed: args.name };
    }
    throw Error("Invalid marketplace action");
  }
  async function source(qualified: string) {
    const [plugin, market] = qualified.split("@");
    if (
      !market ||
      !name.safeParse(plugin).success ||
      !name.safeParse(market).success
    )
      throw Error("Use plugin@marketplace");
    const reg = (await registrations())[market];
    if (!reg) throw Error("Unknown marketplace");
    const entry = (await catalog(reg)).plugins.find((p) => p.name === plugin);
    if (!entry) throw Error("Plugin is not in marketplace");
    if (typeof entry.source === "string")
      return {
        name: plugin,
        directory: await contained(reg.root!, entry.source),
        repository: reg.source,
        ref: reg.commit ?? reg.ref,
        marketplace: market,
      };
    const s = entry.source,
      repository =
        s.source === "github" ? `https://github.com/${s.repo}.git` : s.url;
    if (!repository) throw Error("Missing source repository");
    return {
      name: plugin,
      repository,
      ref: s.sha ?? s.ref ?? "HEAD",
      path: s.path,
      marketplace: market,
    };
  }
  const tool: any = {
    name: "marketplace_control",
    description:
      "Register/list/refresh/remove Claude-format marketplaces. add accepts a local root or HTTPS Git repository (owner/repo shorthand). Updates are explicit.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "update", "remove"] },
        name: { type: "string" },
        source: { type: "string" },
        ref: { type: "string" },
        scope: { type: "string", enum: ["user", "project"] },
      },
      required: ["action"],
    },
    describe: (a: any) => ({
      tool: a.action === "list" ? "extension_list" : "extension_control",
      command: [a.action, a.source ?? a.name ?? ""],
    }),
    execute: async (ctx: any, args: any) => {
      try {
        return { ok: true, data: await control(args, ctx.signal) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  };
  const plugin: any = {
    manifest: {
      name: "marketplace-manager",
      version: "1.0.0",
      trust: "trusted",
    },
    hooks: {
      "prompt.submit": async (e: any, $: any) => {
        const words = e.text.trim().split(/\s+/),
          [cmd, action = "list", source, ref] = words.filter(
            (word: string) => !word.startsWith("--")
          );
        const scope = words.includes("--project") ? "project" : "user";
        if (cmd !== "/marketplace") return;
        const result = await $.agent.tool("marketplace_control", {
          action,
          ...(action === "add" ? { source, ref, scope } : { name: source }),
        });
        await $.ui.surface(
          "marketplaces",
          "Marketplaces",
          JSON.stringify(result, null, 2),
          { site: "inspector" }
        );
        return { drop: "marketplace: handled" };
      },
    },
  };
  return { tool, plugin, source, control };
}
