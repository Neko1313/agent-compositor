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
import {bundledMarketplaceRoot,DEFAULT_MARKETPLACE,DEFAULT_MARKETPLACE_REPOSITORY} from './bundled-marketplace.js';
import {marketplaceView,extensionView} from './extension-views.js';
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
          compositor:z.object({format:z.string().optional()}).passthrough().optional(),
          source: z.union([
            z.string(),
            z
              .object({
                source: z.enum(["github", "url", "archive"]),
                repo: z.string().optional(),
                url: z.string().optional(),
                ref: z.string().optional(),
                sha: z
                  .string()
                  .regex(/^[a-f0-9]{40}$/)
                  .optional(),
                path: z.string().optional(),
                assets:z.record(z.string(),z.object({url:z.string().url(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).optional(),
              })
              .passthrough().superRefine((source,ctx)=>{
                if(source.source==='archive'&&(!source.assets||!Object.keys(source.assets).length))ctx.addIssue({code:'custom',message:'Archive source needs pinned platform assets'});
                if(source.source==='github'&&!source.repo)ctx.addIssue({code:'custom',message:'GitHub source needs a repository'});
                if(source.source==='url'&&!source.url)ctx.addIssue({code:'custom',message:'Git source needs a URL'});
              }),
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
  builtin?:boolean;
  removed?:boolean;
};
export async function marketplaces(
  cwd: string,
  home: string,
  stateDir: string,
  globalRoot = join(home, ".agent-compositor"),
  snapshotRoot?:string,
) {
  const builtinRoot=snapshotRoot??await bundledMarketplaceRoot();
  const shipped=!!builtinRoot&&await readFile(join(builtinRoot,'VERSION'),'utf8').then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});
  const builtin:Record<string,Registration>=builtinRoot?{[DEFAULT_MARKETPLACE]:{source:DEFAULT_MARKETPLACE_REPOSITORY,ref:'main',root:builtinRoot,name:DEFAULT_MARKETPLACE,scope:'user',builtin:true}}:{};
  const globalFile = join(globalRoot, "marketplaces.json"),
    projectFile = join(cwd, ".agent-compositor/marketplaces.json");
  const read = async (file: string): Promise<Record<string, Registration>> =>
    readFile(file, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return {};
      });
  const registrations = async () => Object.fromEntries(Object.entries({
    ...builtin,
    ...(await read(globalFile)),
    ...(await read(projectFile)),
  }).filter(([,reg])=>!reg.removed)) as Record<string,Registration>;
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
      if(builtin[args.name])existing[args.name]={...reg,removed:true};
      else delete existing[args.name];
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
    if (typeof entry.source === "string"){
      let directory=await contained(reg.root!,entry.source);
      if(shipped&&market===DEFAULT_MARKETPLACE&&reg.source===DEFAULT_MARKETPLACE_REPOSITORY&&entry.compositor?.format==='native'){
        const cached=await contained(builtinRoot!,join('plugins',plugin));
        const metadata=JSON.parse(await readFile(join(cached,'plugin.json'),'utf8'));
        if(metadata.version!==entry.version)throw Error('This plugin version requires a published archive entry; the catalog has unreleased source code');
        directory=cached;
      }
      return {
        name: plugin,
        directory,
        repository: reg.source,
        ref: reg.commit ?? reg.ref,
        marketplace: market,
        version:entry.version,
        format:entry.compositor,
      };
    }
    const s = entry.source,
      repository =
        s.source === "github" ? `https://github.com/${s.repo}.git` : s.url;
    if(s.source==='archive'){
      const archive=s.assets?.[`${process.platform}-${process.arch}`];
      if(!archive||!entry.version)throw Error('Missing version or archive for this platform');
      return{name:plugin,version:entry.version,archive,ref:archive.sha256,repository:archive.url,marketplace:market,format:entry.compositor};
    }
    if (!repository) throw Error("Missing source repository");
    return {
      name: plugin,
      repository,
      ref: s.sha ?? s.ref ?? "HEAD",
      path: s.path,
      marketplace: market,
      version:entry.version,
      format:entry.compositor,
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
      command: [a.action, a.source ?? a.name ?? "",...(a.action==='add'?['--'+(a.scope??'user')]:[])],
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
      hookTimeouts:{'ui.press':300000,'prompt.submit':300000},
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
        await $.ui.view(
          "marketplaces",
          "Marketplaces",
          marketplaceView(result),
          { site: "inspector" }
        );
        return { drop: "marketplace: handled" };
      },
      'ui.press':async(e:any,$:any)=>{
        if(e.site!=='plugin-marketplace-manager-marketplaces')return;
        if(e.key.startsWith('catalog:')){
          const market=e.key.slice(8),reg=(await registrations())[market];if(!reg)return;
          const data=await catalog(reg);
          await $.ui.view('marketplaces','Marketplaces',{lines:[{text:market,bold:true},{text:'Choose a plugin to install. Installation leaves it off.',tone:'muted'},...data.plugins.map(p=>({text:`${p.name}  v${p.version??'unversioned'}`,action:'install:'+p.name+'@'+market}))]},{site:'inspector'});
        }else if(e.key.startsWith('install:')){
          const name=e.key.slice(8);
          const form=await $.ui.form({title:`Install ${name}`,fields:[{id:'scope',label:'Scope',type:'select',value:'project',options:[{value:'project',label:'This project'},{value:'user',label:'All my projects'}]}],actions:[{id:'install',label:'Install inactive'},{id:'cancel',label:'Cancel'}]});
          if(!form||form.action!=='install')return;
          const result=await $.agent.tool('extension_control',{action:'install',name,scope:form.values.scope});
          await $.ui.view('marketplaces','Marketplaces',extensionView('install',result),{site:'inspector'});
        }
      },
    },
  };
  const published=async()=>{
    const reg=(await registrations())[DEFAULT_MARKETPLACE];
    return reg?Object.fromEntries((await catalog(reg)).plugins.map(plugin=>[plugin.name,plugin.version])):{};
  };
  return { tool, plugin, source, control, builtinRoot,shipped,published };
}
