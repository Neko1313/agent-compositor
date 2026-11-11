import { execFile } from "node:child_process";
import {randomUUID} from 'node:crypto';
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
import { join, dirname, relative, isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  diskManifestSchema,
  claudeManifest,
  loadClaudePlugin,
  contained,
  readPluginMcp,
  compareVersions,
} from "@agent-compositor/loader";
import { atomicJson } from "@agent-compositor/config";
import {pluginSelection} from './plugin-activation.js';
import {pluginDigest} from './plugin-digest.js';
import {managementResult} from './plugin-services.js';
import {extensionView,pendingManagementView} from './extension-views.js';
import {installPluginArchive} from './plugin-archive.js';
import type { CorePlugin } from "@agent-compositor/core";
import type { ToolSpec } from "@agent-compositor/tools";
import { checkout as checkoutRepo, type marketplaces } from "./marketplaces.js";
/** Supply the same public SDK for installed native packages and archive certification. */
export async function linkPublicSdk(source:string){
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
    "context",
    "permissions",
    "app",
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

const exec = promisify(execFile);
type Installed = {
  repository: string;
  ref: string;
  commit: string;
  qualified?: string;
  path?: string;
  scope?: "user" | "project";
  version?: string;
  digest?: string;
  location?:'user'|'project'|'legacy';
};
type State = { enabled?:string[]; disabled: string[]; bindings?:Record<string,string>; installed: Record<string, Installed>; backups?:Record<string,{path:string;installed:Installed}[]> };
export async function extensionManager(
  cwd: string,
  home: string,
  stateRoot = join(cwd, ".agent-compositor"),
  market?: Awaited<ReturnType<typeof marketplaces>>,
  globalRoot = join(home, ".agent-compositor"),
  allowlist?:string[],
  blocked:string[]=[],
) {
  const legacyProjectDirectory=join(cwd,'.agent-compositor/plugins');
  const projectDirectory=resolve(legacyProjectDirectory)===resolve(globalRoot,'plugins')?join(stateRoot,'project-plugins'):legacyProjectDirectory;
  const files = {
    user: join(globalRoot, "extensions-state.json"),
    project: join(stateRoot, "extensions-state.json"),
  };
  const read = async (file: string): Promise<State> => {
    const state:State=await readFile(file, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return { disabled: [], installed: {} };
      });
    if(file===files.project&&projectDirectory!==legacyProjectDirectory)for(const [name,entry]of Object.entries(state.installed)){
      if(!/^[a-z0-9][a-z0-9._-]*$/.test(name))throw Error('Invalid installed plugin identity');
      if(!entry.location&&await stat(join(legacyProjectDirectory,name)).catch(()=>undefined)&&!await stat(join(projectDirectory,name)).catch(()=>undefined))entry.location='legacy';
    }
    return state;
  };
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
  const enabled = () => pluginSelection(states.user,states.project,allowlist).filter(name=>!blocked.includes(name));
  const disabled = () => [...new Set([...states.user.disabled,...states.project.disabled])].filter(name=>!enabled().includes(name));
  let available:()=>Promise<{name:string;version:string;kind?:string;shared?:boolean;bundled?:boolean;directory?:string}[]> = async()=>[];
  const activationScope=(name:string)=>states.project.enabled?.includes(name)?'project':states.user.enabled?.includes(name)?'user':'configured';
  const installedPath=(scope:'user'|'project',name:string)=>join(scope==='user'?join(globalRoot,'plugins'):states.project.installed[name]?.location==='legacy'?legacyProjectDirectory:projectDirectory,name);
  const selectedPath=(name:string)=>{
    const scope=activationScope(name),bound=scope==='configured'?undefined:states[scope].bindings?.[name];
    return bound??(scope!=='user'&&states.project.installed[name]?installedPath('project',name):states.user.installed[name]?installedPath('user',name):undefined);
  };
  const inventory=async()=>{
    const rows=new Map<string,Awaited<ReturnType<typeof available>>[number]>();
    for(const plugin of await available()){
      const current=rows.get(plugin.name);
      if(!current||plugin.directory===selectedPath(plugin.name)||activationScope(plugin.name)==='user'&&!current.shared&&plugin.shared)rows.set(plugin.name,plugin);
    }
    return [...rows.values()];
  };
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
  async function control(args: any, signal: AbortSignal,fetcher:typeof fetch=fetch) {
    if (args.action === "list"){
      const rows=await inventory(),selected=enabled();
      return {
        catalog: await catalog(),
        installed: installed(),
        disabled: disabled(),
        enabled: enabled(),
        scopes: {user:{enabled:states.user.enabled??[],disabled:states.user.disabled},project:{enabled:states.project.enabled??[],disabled:states.project.disabled}},
        available: rows.map(plugin=>({...plugin,enabled:selected.includes(plugin.name)&&(!selectedPath(plugin.name)||selectedPath(plugin.name)===plugin.directory)})),
        unavailable:selected.filter(name=>selectedPath(name)&&!rows.some(plugin=>plugin.name===name&&plugin.directory===selectedPath(name))),
        reload: "Use /reload after changes",
      };
    }
    if(args.action==='check-updates'){
      const updates=[];
      for(const scope of ['user','project'] as const)for(const [name,entry]of Object.entries(states[scope].installed)){
        if(args.scope&&args.scope!==scope||args.name&&String(args.name).split('@')[0]!==name)continue;
        try{
          const candidate=entry.qualified?await market?.source(entry.qualified):undefined;
          const version=candidate?.version;
          updates.push({name,scope,installedVersion:entry.version,availableVersion:version,updateAvailable:!!version&&(!entry.version||compareVersions(version,entry.version)>0)});
        }catch(error){updates.push({name,scope,error:String(error)});}
      }
      return {updates};
    }
    const name = String(args.name ?? "").split("@")[0];
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
          : state.installed[name]?.location==='legacy'?legacyProjectDirectory:projectDirectory;
      const destination=join(dir,name);
      if (["enable", "disable"].includes(args.action)) {
        if(args.action==='enable' && allowlist && !allowlist.includes(name))throw Error('Plugin is excluded by enabledPlugins; add it to that explicit allowlist first');
        if(args.action==='enable' && blocked.includes(name))throw Error('Plugin is blocked by disabledPlugins; remove that explicit restriction first');
        if(args.action==='enable' && !(await available()).some(plugin=>plugin.name===name))throw Error('Plugin is not installed or available locally; install it first');
        if(args.action==='enable' && scope==='user' && !(await available()).some(plugin=>plugin.name===name&&plugin.shared))throw Error('A project-local plugin requires project scope or a user-scoped installation');
        if(args.action==='enable'){
          const candidates=(await available()).filter(plugin=>plugin.name===name&&(scope!=='user'||plugin.shared));
          if(candidates.every(plugin=>plugin.bundled))throw Error(`Install ${name}@agent-compositor --${scope} first to pin a version independently of the app`);
          const expected=state.installed[name]?installedPath(scope,name):undefined;
          const selected=expected?candidates.find(plugin=>plugin.directory===expected):(scope==='project'?candidates.find(plugin=>!plugin.bundled&&!plugin.shared):undefined)??candidates.find(plugin=>!plugin.bundled);
          if(!selected?.directory)throw Error('Installed plugin files are unavailable; remove the missing installation and install it again');
          state.bindings??={};state.bindings[name]=selected.directory;
        }
        if(args.action==='disable'&&state.bindings)delete state.bindings[name];
        state.enabled = (state.enabled??[]).filter(n=>n!==name);
        state.disabled = state.disabled.filter((n) => n !== name);
        if (args.action === "enable") state.enabled.push(name);
        if (args.action === "disable") state.disabled.push(name);
        await atomicJson(files[scope], state);
        return { changed: name, scope, enabled:enabled().includes(name), reloadRequired: true };
      }
      await mkdir(dir, { recursive: true });
      const backup = async () => {
        const destination = join(
          globalRoot,
          "extension-backups",
          `${name}-${Date.now()}-${randomUUID()}`
        );
        await mkdir(join(globalRoot, "extension-backups"), { recursive: true });
        await rename(join(dir, name), destination);
        return destination;
      };
      if(args.action==='rollback'){
        const history=state.backups?.[name]??[],previous=history.at(-1);
        if(!previous)throw Error('No previous managed version to roll back to');
        const old=structuredClone(state),current=state.installed[name];
        if(!current)throw Error('Plugin is not installed in this scope');
        if(current.digest&&await pluginDigest(destination)!==current.digest)throw Error('Installed plugin content changed; preserve local edits before rollback');
        await contained(join(globalRoot,'extension-backups'),previous.path);
        if(previous.installed.digest && await pluginDigest(previous.path)!==previous.installed.digest)throw Error('Backup content does not match its version lock');
        const saved=await backup();
        try{
          await rename(previous.path,destination);
          state.installed[name]=previous.installed;
          state.backups??={};state.backups[name]=[...history.slice(0,-1),{path:saved,installed:current}];
          await atomicJson(files[scope],state);
        }catch(error){
          if(await stat(destination).catch(()=>undefined))await rename(destination,previous.path);
          await rename(saved,destination);states[scope]=old;throw error;
        }
        return{name,scope,version:previous.installed.version,reloadRequired:true};
      }
      if (args.action === "remove") {
        if (!state.installed[name])
          throw Error("Only managed extensions in this scope can be removed");
        const saved = await stat(destination).catch(()=>undefined)?await backup():undefined;
        const old=structuredClone(state);
        delete state.installed[name];
        state.enabled=(state.enabled??[]).filter(n=>n!==name);
        if(!state.disabled.includes(name))state.disabled.push(name);
        if(state.bindings)delete state.bindings[name];
        try{await atomicJson(files[scope], state);}catch(error){if(saved)await rename(saved,destination);states[scope]=old;throw error;}
        return { removed: name, scope, backup: saved, reloadRequired: true };
      }
      if (!["install", "update"].includes(args.action))
        throw Error("Invalid extension action");
      const qualified=args.name?.includes('@')?args.name:state.installed[name]?.qualified;
      const entry: any =
        (qualified?.includes("@")
          ? await market?.source(qualified)
          : undefined) ??
        (await catalog()).find((r) => r.name === name) ??
        state.installed[name];
      if (!entry) throw Error("Extension is not in the configured catalog");
      if(entry.archive&&args.ref)throw Error('Archive versions are pinned by the catalog; refresh the catalog or use rollback');
      const ref = String(args.ref ?? entry.ref ?? "");
      if (!ref) throw Error("Explicit valid ref is required");
      const temp = await mkdtemp(join(dir, ".install-")),
        checkout = join(temp, "checkout");
      try {
        let commit: string;
        let source:string;
        if(entry.archive){
          source=await installPluginArchive(entry.archive,checkout,name,signal,fetcher);commit=entry.archive.sha256;
        }else if (entry.directory) {
          await cp(entry.directory, checkout, {
            recursive: true,
            dereference: false,
          });
          commit = "local";
          source=checkout;
        } else
          {commit = await checkoutRepo(
            String(entry.repository),
            ref,
            checkout,
            signal
          );source=checkout;}
        source = entry.path
          ? await contained(checkout, entry.path)
          : source;
        const native = await readFile(join(source, "plugin.json"), "utf8").catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        let manifest;
        if (native !== undefined) {
          manifest = diskManifestSchema.parse(JSON.parse(native));
          const servers = await readPluginMcp(source, manifest.name, manifest.mcpServers);
          if (manifest.trust === 'render-only' && Object.keys(servers).length)
            throw Error('render-only plugins may not contribute MCP servers');
          for (const resource of manifest.resources ?? []) await contained(source, resource);
        } else {
          manifest = await claudeManifest(source);
          await loadClaudePlugin(source);
        }
        if (manifest.name !== name)
          throw Error("Catalog name does not match manifest");
        if(entry.version && manifest.version!==entry.version)throw Error('Catalog version does not match plugin manifest');
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
        if (await stat(join(source, "plugin.json")).catch(() => undefined)) await linkPublicSdk(source);
        const digest=await pluginDigest(source),current=state.installed[name]?{...state.installed[name]}:undefined;
        if(args.action==='update' && !current)throw Error('Plugin is not installed in this scope');
        if(current&&!current.digest){
          current.digest=await pluginDigest(destination);
          const native=await readFile(join(destination,'plugin.json'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return undefined;});
          current.version=native?diskManifestSchema.parse(JSON.parse(native)).version:(await claudeManifest(destination)).version;
        }
        if(current?.digest && await pluginDigest(destination)!==current.digest)throw Error('Installed plugin content changed; preserve local edits before updating');
        if(current?.version){
          const comparison=compareVersions(manifest.version,current.version);
          if(comparison===0 && current.digest && current.digest!==digest)throw Error('Published plugin version changed contents; publish a new version');
          if(comparison<0)throw Error('Updates cannot downgrade a version; use rollback');
          if(comparison===0)return{name,scope,version:current.version,unchanged:true,reloadRequired:false};
        }
        const previous = await stat(join(dir, name)).catch(() => undefined);
        if(args.action==='install' && previous)throw Error('Plugin already exists in this scope; use update for managed versions');
        const old=structuredClone(state);
        const saved = previous ? await backup() : undefined;
        try {
          signal.throwIfAborted();
          await rename(source, join(dir, name));
          state.installed[name] = {
          repository: entry.repository,
          ref,
          commit,
          scope,
          version:manifest.version,
          digest,
          location:scope==='user'?'user':dir===projectDirectory?'project':'legacy',
          ...(qualified?.includes("@") ? { qualified } : {}),
          ...(entry.path ? { path: entry.path } : {}),
        };
        if(saved && current){state.backups??={};state.backups[name]=[...(state.backups[name]??[]),{path:saved,installed:current}];}
        if(args.action==='install'){
          if(state.bindings)delete state.bindings[name];
          state.enabled=(state.enabled??[]).filter(n=>n!==name);
          if(!state.disabled.includes(name))state.disabled.push(name);
        }
        signal.throwIfAborted();
        await atomicJson(files[scope], state);
        } catch (e) {
          await rm(destination,{recursive:true,force:true});
          if (saved) await rename(saved, destination);
          states[scope]=old;
          throw e;
        }
        return {
          name,
          version: manifest.version,
          trust: manifest.trust,
          commit,
          scope,
          activated:false,
          enabled:enabled().includes(name),
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
      "List/check-updates/install/update/rollback/enable/disable/remove plugins in user/project scopes. Installation stays inactive; explicit enable and /reload apply it. Versions/content are locked; archive checksums are verified. Dependencies require an explicit locked installation without package scripts.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "check-updates", "install", "update", "rollback", "enable", "disable", "remove"],
        },
        name: { type: "string" },
        ref: { type: "string" },
        scope: { type: "string", enum: ["user", "project"] },
        dependencies: { type: "boolean" },
      },
      required: ["action"],
    },
    describe: (a: any) => ({
      tool: ['list','check-updates'].includes(a.action) ? "extension_list" : "extension_control",
      command: [a.action, a.name ?? "", a.ref ?? "",'--'+(a.scope??(['enable','disable'].includes(a.action)?'project':installed()[String(a.name??'').split('@')[0]]?.scope??'user'))],
    }),
    execute: async (ctx, args) => {
      try {
        return { ok: true, data: await control(args, ctx.signal,ctx.fetch) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  };
  let runtimeBusy=()=>false;
  let userFetch:typeof fetch=fetch;
  const pending=new Map<string,any>();
  const applyPending=async()=>{
    if(runtimeBusy())throw Error('Wait for running agents before applying plugin changes');
    if(busy)throw Error('Another extension operation is in progress; retry Apply when it finishes');
    for(const [key,args]of pending){await control(args,AbortSignal.timeout(300000),userFetch);pending.delete(key);}
  };
  const userControl = async (args:any, signal:AbortSignal) => {
    if(runtimeBusy()&&['update','rollback','remove'].includes(args.action)){
      const name=String(args.name??'').split('@')[0],scope=args.scope??installed()[name]?.scope??'user';
      if(!/^[a-z0-9][a-z0-9._-]*$/.test(name)||!['user','project'].includes(scope))return{ok:false,error:'Choose a valid installed plugin and scope'};
      pending.set(`${scope}:${name}`,{...args,name,scope});
      return {ok:true,data:{name,scope,queued:true}};
    }
    try { return {ok:true,data:await control(args,signal,userFetch)}; }
    catch(error) { return {ok:false,error:String(error)}; }
  };
  const plugin: CorePlugin = {
    manifest: { name: "extension-manager", version: "1.1.0", trust: "trusted",hookTimeouts:{'ui.press':300000,'prompt.submit':300000} },
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
        await $.ui.view(
          "extensions",
          "Extensions",
          extensionView(action,result),
          { site: "sidebar", size: .5, focus: true }
        );
        return { drop: "extension-manager: handled" };
      },
      'ui.press':async(event,$)=>{
        if(event.site!=='plugin-extension-manager-extensions')return;
        if(event.key.startsWith('command:')){
          const words=event.key.slice(8).trim().split(/\s+/);
          const [,action='list',name,ref]=words.filter((word:string)=>!word.startsWith('--'));
          if(!['list','check-updates'].includes(action))await $.ui.view('extensions','Extensions',pendingManagementView(action,name),{site:'sidebar',size:.5,focus:true});
          const result=await managementResult($,'service.extension.control',{action,name,ref,scope:words.includes('--project')?'project':words.includes('--user')?'user':undefined,dependencies:words.includes('--dependencies')});
          await $.ui.view('extensions','Extensions',extensionView(action,result),{site:'sidebar',size:.5,focus:true});
          return;
        }
        if(event.key==='updates'){
          await $.ui.view('extensions','Extensions',extensionView('check-updates',await managementResult($,'service.extension.control',{action:'check-updates'})),{site:'sidebar',size:.5,focus:true});return;
        }
        if(!event.key.startsWith('manage:'))return;
        const name=event.key.slice(7);
        const bundled=(await inventory()).find(plugin=>plugin.name===name)?.bundled;
        const form=await $.ui.form({title:`Manage ${name}`,fields:[
          {id:'action',label:'Action',type:'select',value:bundled?'install':'enable',options:[...(bundled?['install']:[]),'enable','disable','update','rollback','remove'].map(value=>({value,label:value}))},
          {id:'scope',label:'Scope',type:'select',value:installed()[name]?.scope??'project',options:[{value:'project',label:'This project'},{value:'user',label:'All my projects'}]},
        ],actions:[{id:'apply',label:'Apply'},{id:'cancel',label:'Cancel'}]});
        if(!form||form.action!=='apply')return;
        const action=String(form.values.action),scope=String(form.values.scope);
        await $.ui.view('extensions','Extensions',pendingManagementView(action,name),{site:'sidebar',size:.5,focus:true});
        const result=await managementResult($,'service.extension.control',{action,name:action==='install'?name+'@agent-compositor':name,scope});
        await $.ui.view('extensions','Extensions',extensionView(action,result),{site:'sidebar',size:.5,focus:true});
      },
    },
  };
  return { tool, plugin, userControl, applyPending, setUserRuntime:(busy:()=>boolean,fetcher:typeof fetch)=>{runtimeBusy=busy;userFetch=fetcher;}, disabled, enabled,activationScope,selectedPath,projectDirectory,
    boundDirectories:()=>enabled().flatMap(name=>{const path=selectedPath(name);return path?[path]:[];}),
    refresh:async()=>{states.user=await read(files.user);states.project=await read(files.project);},
    setAvailable:(read:typeof available)=>{available=read;} };
}
