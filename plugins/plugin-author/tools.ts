import { mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CATALOG_VERSION, byName } from '@agent-compositor/events';
import { contained, diskManifestSchema, DEFAULT_MAIN_CANDIDATES, readPluginMcp } from '@agent-compositor/loader';
import { splitFrontmatter } from '@agent-compositor/skills';
import type { ToolContext, ToolSpec } from '@agent-compositor/tools';

const home = dirname(fileURLToPath(import.meta.url));
const kinds = ['command', 'tool', 'panel', 'skill', 'service', 'mcp'] as const;
const guides = {
  overview: 'SKILL.md',
  contracts: 'references/contracts.md',
  patterns: 'references/patterns.md',
  testing: 'references/testing.md',
  composition: 'references/composition.md',
};
interface Args {
  action: 'guide' | 'init' | 'check';
  topic?: keyof typeof guides | 'events';
  event?: string;
  name?: string;
  kind?: typeof kinds[number];
  components?: typeof kinds[number][];
  path?: string;
}
const exists = async (path:string) => stat(path).then(() => true, (error:NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
async function text(path:string) {
  if ((await stat(path)).size > 64000) throw Error('Metadata file exceeds 64 KiB');
  return readFile(path, 'utf8');
}
async function workspace(ctx:ToolContext, path:string, missing = false) {
  if (!ctx.resolvePath) throw Error('Local workspace path resolution is unavailable');
  ctx.signal.throwIfAborted();
  return ctx.resolvePath(path, {missing});
}

async function guide(args:Args) {
  const topic = args.topic ?? 'overview';
  if (topic === 'events') {
    if (args.event) {
      const event = byName.get(args.event);
      if (!event) throw Error('Unknown canonical event name');
      const schema = (value:z.ZodType) => z.toJSONSchema(value, {io:'input', unrepresentable:'any'});
      return {catalogVersion:CATALOG_VERSION, name:event.name, summary:event.summary, input:schema(event.input),
        responses:event.responses.map(response => ({kind:response.kind, summary:response.summary, schema:schema(response.schema)}))};
    }
    return {catalogVersion:CATALOG_VERSION, events:[...byName.values()].map(event => ({name:event.name, summary:event.summary}))};
  }
  if (!Object.hasOwn(guides, topic)) throw Error('Unknown guide topic');
  const path = join(home, 'skills/create-plugin', guides[topic]);
  return {topic, text:await text(path), topics:[...Object.keys(guides), 'events']};
}

function starter(name:string, components:readonly typeof kinds[number][]) {
  const selected = new Set(components);
  const manifest:Record<string,unknown> = {name, version:'0.1.0', description:`Local ${name} extension`, trust:'trusted'};
  const files:Record<string,string> = {};
  const hooks:string[] = [];
  if (selected.has('tool')) {
    files['tools.ts'] = `export default [{
  name: '${name.replaceAll('-', '_')}',
  description: 'Return the provided message; replace with the requested behavior.',
  parameters: {type:'object', properties:{message:{type:'string'}}, required:['message']},
  describe: () => ({tool:'${name.replaceAll('-', '_')}', readOnly:true}),
  execute: async (_ctx, args) => ({ok:true, data:{message:String(args.message)}}),
}];\n`;
  }
  if (selected.has('service')) {
    manifest.provides = ['service.agent.instructions'];
    const instructions = 'Help the user with the selected domain; verify claims against actual tool results.'
      + (selected.has('skill') ? ` Load the ${name} workflow with the skills tool when relevant.` : '')
      + (selected.has('mcp') ? ` MCP server ${name}-local is available through the enabled mcp_call gateway.` : '');
    hooks.push(`  'service.agent.instructions': async () => ({value:${JSON.stringify(instructions)}}),`);
  }
  if (selected.has('command') || selected.has('panel')) {
    manifest.commands = [{name:'/'+name, description:`Open ${name}`}];
    const effects = [
      selected.has('command') ? `    await $.ui.notify('${name} ready');` : '',
      selected.has('panel') ? `    await $.ui.view('main', '${name}', {lines:[{text:'${name} ready'}]}, {site:'sidebar',size:0.25,focus:false});` : '',
    ].filter(Boolean).join('\n');
    hooks.push(`  'prompt.submit': async (event, $) => {
    if (event.text.trim() !== '/${name}') return;
${effects}
    return {drop:'${name}: handled'};
  },`);
  }
  if (hooks.length) {
    manifest.main = 'hooks.ts';
    files['hooks.ts'] = 'export default {\n'+hooks.join('\n')+'\n};\n';
  }
  if (selected.has('skill'))
    files[`skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: Apply the local ${name} workflow when the user requests it.\n---\n\nComplete the requested workflow using the available tools. Define the concrete inputs, procedure and observable result for this extension.\n`;
  if (selected.has('mcp')) {
    manifest.mcpServers = '.mcp.json';
    manifest.resources = ['mcp'];
    files['.mcp.json'] = JSON.stringify({mcpServers:{local:{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/mcp/server.mjs'],cwd:'${PLUGIN_ROOT}'}}},null,2)+'\n';
    files['mcp/server.mjs'] = `import {createInterface} from 'node:readline';
const input = createInterface({input:process.stdin});
input.on('line', line => {
  let request; try { request=JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  let result, error;
  if (request.method === 'initialize') result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'${name}',version:'0.1.0'}};
  else if (request.method === 'tools/list') result={tools:[{name:'ping',description:'Check the local ${name} server',inputSchema:{type:'object',properties:{}}}]};
  else if (request.method === 'tools/call' && request.params?.name === 'ping') result={content:[{type:'text',text:'${name} MCP ready'}]};
  else error={code:-32601,message:'Unknown method or tool'};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,...(error?{error}:{result})})+'\\n');
});\n`;
  }
  files['plugin.json'] = JSON.stringify(manifest, null, 2) + '\n';
  return files;
}

async function init(ctx:ToolContext, args:Args) {
  if (!args.name || !/^[a-z][a-z0-9-]{0,47}$/.test(args.name)) throw Error('Use a plugin name with lowercase letters, digits and hyphens (1..48 characters)');
  if (args.kind !== undefined && args.components !== undefined) throw Error('Use either kind or components, not both');
  const components = args.components ?? [args.kind ?? 'command'];
  if (!Array.isArray(components) || !components.length || new Set(components).size !== components.length || components.some(kind=>!kinds.includes(kind))) throw Error('Choose one or more distinct known components');
  const kind = components.length === 1 ? components[0] : 'composite';
  const destination = await workspace(ctx, args.path ?? `.agent-compositor/plugins/${args.name}`, true);
  const files = starter(args.name, components);
  await mkdir(dirname(destination), {recursive:true});
  await mkdir(destination); // Existing projects are never overwritten, including empty directories.
  try {
    for (const [name, value] of Object.entries(files)) {
      ctx.signal.throwIfAborted();
      await mkdir(dirname(join(destination, name)), {recursive:true});
      await writeFile(join(destination, name), value, {flag:'wx'});
    }
    // Native plugins outside the checkout need the installed public SDK too.
    const require = createRequire(import.meta.url);
    const sdk = join(destination, 'node_modules/@agent-compositor');
    await mkdir(sdk, {recursive:true});
    for (const api of ['events','hooks','tools','runtime','skills','core','config','protocol','provider','session','loader','plugins','context','permissions','app']) {
      ctx.signal.throwIfAborted();
      let source = dirname(require.resolve('@agent-compositor/' + api));
      while (!await exists(join(source, 'package.json'))) {
        const parent = dirname(source);
        if (parent === source) throw Error(`Public SDK package unavailable: ${api}`);
        source = parent;
      }
      await symlink(source, join(sdk, api), 'dir');
    }
    ctx.signal.throwIfAborted();
    return {path:destination, kind, components, files:Object.keys(files), activated:false,
      requirements:components.includes('mcp')?['Enable the mcp plugin/mcp_call gateway; the sample stdio server needs Node.js (or an explicitly configured runtime).']:[],
      next:'Edit the starter for the request, run plugin_dev check and behavior checks, then use /reload between turns. Explicit enabledPlugins allowlists must include this plugin. Changes to provider/controller selections require restarting the app.'};
  } catch (error) {
    await rm(destination, {recursive:true, force:true});
    throw error;
  }
}

async function check(ctx:ToolContext, args:Args) {
  if (!args.path) throw Error('Provide the plugin directory in path');
  const root = await realpath(await workspace(ctx, args.path));
  const manifest = diskManifestSchema.parse(JSON.parse(await text(await contained(root, 'plugin.json'))));
  const errors:string[] = [];
  const warnings:string[] = [];
  const entryFiles:string[] = [];
  const mcpServers = Object.keys(await readPluginMcp(root, manifest.name, manifest.mcpServers));
  for (const resource of manifest.resources ?? []) await contained(root,resource);
  if (manifest.trust === 'render-only' && mcpServers.length) errors.push('render-only plugins may not contribute MCP servers.');
  if (manifest.trust === 'sandboxed') errors.push('Native modules require a trusted/render-only host; sandboxed TS modules cannot be loaded.');
  const candidates = manifest.main || manifest.entry ? [manifest.main ?? manifest.entry!] : DEFAULT_MAIN_CANDIDATES;
  for (const file of candidates) {
    if (await exists(join(root, file))) {
      entryFiles.push(await contained(root, file));
      break;
    }
  }
  for (const file of ['tools.ts', 'tools.js']) {
    if (await exists(join(root, file))) entryFiles.push(await contained(root, file));
  }
  if ((manifest.main || manifest.entry) && !await exists(join(root, manifest.main ?? manifest.entry!))) errors.push('The declared main/entry file does not exist.');
  const skills:string[] = [];
  if (await exists(join(root, 'skills'))) {
    const directory = await contained(root, 'skills');
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      if (entry.isFile() && !entry.name.endsWith('.md')) continue;
      const relative = entry.isDirectory() ? `skills/${entry.name}/SKILL.md` : `skills/${entry.name}`;
      if (!await exists(join(root, relative))) { errors.push(`Missing ${relative}`); continue; }
      const {frontmatter} = splitFrontmatter(await text(await contained(root, relative)));
      if (!frontmatter.name?.trim() || !frontmatter.description?.trim()) errors.push(`Skill needs name and description: ${relative}`);
      else skills.push(frontmatter.name);
    }
  }
  if (!entryFiles.length && !skills.length && !mcpServers.length) errors.push('No hook/controller entry, tools, described skills or MCP servers found.');
  if (mcpServers.length) warnings.push('MCP declarations require the enabled mcp/mcp_call gateway. Processes start on use, under normal permission policy.');
  if (manifest.provides?.length) warnings.push('Select service providers explicitly in project configuration; declaration alone does not activate a replacement.');
  return {name:manifest.name, path:root, valid:errors.length === 0, kind:'structure-only', executed:false, entryFiles, skills, mcpServers, resources:manifest.resources??[], errors, warnings,
    next:'This check does not import code or prove behavior. Review the files, use /reload between turns, inspect load errors, then invoke the actual command/tool and verify its effect. Existing enabledPlugins/agent.tools selections still apply.'};
}

const tool:ToolSpec<Args> = {
  name:'plugin_dev',
  description:'Develop Compositor plugins: guide returns installed contracts, init creates a new local starter with SDK links, check validates structure WITHOUT importing code. init mutates files and follows ordinary tool approval. It never edits capability selections or activates code.',
  usage:{when:'Create or improve a Compositor extension using installed contracts and local starter files.',avoid:'A structure check does not execute or activate code. Do not overwrite existing extensions or replace capability allowlists.',examples:[
    {purpose:'Read current contracts',args:{action:'guide',topic:'contracts'}},
    {purpose:'Compose agent logic, UI, a skill and MCP in one package',args:{action:'init',name:'workspace-suite',components:['service','panel','skill','mcp']}},
    {purpose:'Create a local command starter',args:{action:'init',name:'project-helper',kind:'command'}},
    {purpose:'Check an edited plugin without importing it',args:{action:'check',path:'.agent-compositor/plugins/project-helper'}},
  ]},
  parameters:{type:'object', properties:{
    action:{type:'string',enum:['guide','init','check']},
    topic:{type:'string',enum:[...Object.keys(guides),'events']}, event:{type:'string'},
    name:{type:'string'}, kind:{type:'string',enum:[...kinds]}, components:{type:'array',items:{type:'string',enum:[...kinds]},minItems:1,uniqueItems:true}, path:{type:'string'},
  }, required:['action']},
  describe:args=>({tool:'plugin_dev', readOnly:args.action !== 'init',
    ...(args.action !== 'guide' && args.path ? {path:args.path} : {})}),
  async execute(ctx,args) {
    try {
      ctx.signal.throwIfAborted();
      if (args.action === 'guide') return {ok:true,data:await guide(args)};
      if (args.action === 'init') return {ok:true,data:await init(ctx,args)};
      if (args.action === 'check') return {ok:true,data:await check(ctx,args)};
      throw Error('Unknown plugin_dev action');
    } catch (error) {return {ok:false,error:String(error)};}
  },
};
export default [tool];
