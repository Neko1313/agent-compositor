import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider, type CompletionRequest} from '@agent-compositor/core';
import {CATALOG_VERSION} from '@agent-compositor/events';
import {buildApp} from '../src/build.js';

const roots:string[] = [];
const apps:Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, {recursive:true, force:true});
});
async function fixture(steps:ConstructorParameters<typeof ScriptedProvider>[0] = [], config:Record<string,unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ac-author-')); roots.push(root);
  const cwd = join(root, 'project'), home = join(root, 'home');
  await mkdir(cwd); await mkdir(home);
  await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({agent:{projectContext:false}, ...config}));
  const provider = new ScriptedProvider(steps);
  const app = await buildApp({cwd, env:{HOME:home}, provider, agentHub:false, pluginDirs:[join(process.cwd(),'plugins/plugin-author'),join(process.cwd(),'plugins/mcp')]});
  apps.push(app);
  const core = app.createCore(async () => true);
  const events:{event:string;input:Record<string,any>}[] = [];
  core.subscribe(event => {if (event.kind === 'catalog') events.push(event);});
  return {root,cwd,home,provider,app,core,events};
}
const systems = (request:CompletionRequest) => request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');

describe('plugin authoring inside Compositor', () => {
  it('loads the skill, creates and edits an extension, checks it without activation, then runs it after reload', async () => {
    const path = '.agent-compositor/plugins/catalog-greeting';
    const code = `import {CATALOG_VERSION} from '@agent-compositor/events';
import {SessionStore} from '@agent-compositor/session';
export default {'prompt.submit':async(event,$)=>{if(event.text!=='/catalog-greeting')return;if(typeof SessionStore!=='function')throw Error('Session SDK unavailable');await $.ui.notify('CATALOG_GREETING_'+CATALOG_VERSION);return{drop:'greeting'};}};`;
    const f = await fixture([
      {toolCalls:[{name:'skills',args:{name:'create-plugin'}}]},
      {toolCalls:[{name:'plugin_dev',args:{action:'guide',topic:'contracts'}}]},
      {toolCalls:[{name:'plugin_dev',args:{action:'init',name:'catalog-greeting',kind:'command'}}]},
      {toolCalls:[{name:'write',args:{path:path+'/hooks.ts',content:code}}]},
      {toolCalls:[{name:'plugin_dev',args:{action:'check',path}}]},
      {text:'The extension is structurally checked; run /reload to activate it.'},
    ]);

    await f.core.submit('/plugin Create /catalog-greeting to show the installed catalog version');

    expect(f.core.failure).toBeUndefined();
    expect(systems(f.provider.requests[0])).toContain('create-plugin:');
    expect(systems(f.provider.requests[0])).not.toContain('Preserve unrelated settings.');
    expect(f.provider.requests[0].messages.find(m => m.role === 'user')?.content).toContain('Create /catalog-greeting');
    expect(f.core.getMessages().filter(m => m.role === 'tool').at(-1)?.content).toContain('"executed":false');
    expect(f.app.commands().some(c => c.name === '/catalog-greeting')).toBe(false);
    expect(f.events.some(e => String(e.input.message).startsWith('CATALOG_GREETING_'))).toBe(false);

    expect(await f.app.reloadPlugins(f.core)).not.toContain('error');
    const requests = f.provider.requests.length;
    await f.core.submit('/catalog-greeting');
    expect(f.provider.requests).toHaveLength(requests);
    expect(f.app.commands().some(c => c.name === '/catalog-greeting')).toBe(true);
    expect(f.events).toContainEqual(expect.objectContaining({event:'ui.notification',input:expect.objectContaining({message:'CATALOG_GREETING_'+CATALOG_VERSION})}));
  });

  it.each(['command','tool','panel','skill','service','mcp'] as const)('creates a loadable %s starter with the actual host', async kind => {
    const f = await fixture([{text:'Provider checked'}]);
    const created = await f.core.invokeTool('plugin_dev', {action:'init',name:'local-extension',kind});
    expect(created.ok, created.error).toBe(true);
    const path = (created.output as any).path;
    const checked = await f.core.invokeTool('plugin_dev', {action:'check',path});
    expect(checked).toMatchObject({ok:true,output:{valid:true,executed:false}});
    await f.app.reloadPlugins(f.core);
    expect(f.app.plugins.some(p => p.manifest.name === 'local-extension')).toBe(true);
    if (kind === 'tool') expect(await f.core.invokeTool('local_extension',{message:'ACTUAL_TOOL'})).toMatchObject({ok:true,output:{message:'ACTUAL_TOOL'}});
    if (kind === 'skill') expect(await f.core.invokeTool('skills',{name:'local-extension'})).toMatchObject({ok:true,output:{name:'local-extension',source:'plugin:local-extension'}});
    if (kind === 'mcp') expect(await f.core.invokeTool('mcp_call',{action:'call',server:'local-extension-local',tool:'ping'})).toMatchObject({ok:true,output:{content:[{text:'local-extension MCP ready'}]}});
    if (kind === 'command' || kind === 'panel') {
      await f.core.submit('/local-extension');
      expect(f.provider.requests).toHaveLength(0);
      expect(f.events.some(e => e.event === (kind === 'panel' ? 'ui.surface' : 'ui.notification'))).toBe(true);
    }
    if (kind === 'service') {
      await writeFile(join(f.cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},serviceProviders:{'service.agent.instructions':'local-extension'}}));
      const app = await buildApp({cwd:f.cwd,env:{HOME:f.home},provider:f.provider,agentHub:false}); apps.push(app);
      await app.createCore(async()=>false).submit('Use the selected provider');
      expect(systems(f.provider.requests[0])).toContain('Help the user with the selected domain');
    }
  });

  it('composes all components in one package without overwriting hooks or selecting providers', async () => {
    const f=await fixture();
    const components=['command','tool','panel','skill','service','mcp'];
    const created=await f.core.invokeTool('plugin_dev',{action:'init',name:'composed-suite',components});
    expect(created).toMatchObject({ok:true,output:{kind:'composite',components,activated:false}});
    const path=(created.output as any).path;
    expect(await f.core.invokeTool('plugin_dev',{action:'check',path})).toMatchObject({ok:true,output:{valid:true,executed:false,skills:['composed-suite'],mcpServers:['composed-suite-local']}});
    expect(await f.core.invokeTool('plugin_dev',{action:'guide',topic:'composition'})).toMatchObject({ok:true,output:{text:expect.stringContaining('mcpServers')}});
    await f.app.reloadPlugins(f.core);
    await f.core.submit('/composed-suite');
    expect(f.provider.requests).toHaveLength(0);
    expect(f.events.some(e=>e.event==='ui.notification'&&e.input.message==='composed-suite ready')).toBe(true);
    expect(f.events.some(e=>e.event==='ui.surface')).toBe(true);
    expect(await f.core.invokeTool('composed_suite',{message:'native tool'})).toMatchObject({ok:true,output:{message:'native tool'}});
    expect(await f.core.invokeTool('skills',{name:'composed-suite'})).toMatchObject({ok:true,output:{source:'plugin:composed-suite'}});
    expect(await f.core.invokeTool('mcp_call',{action:'call',server:'composed-suite-local',tool:'ping'})).toMatchObject({ok:true,output:{content:[{text:'composed-suite MCP ready'}]}});
    expect(JSON.parse(await readFile(join(f.cwd,'agent-compositor.json'),'utf8'))).toEqual({agent:{projectContext:false}});
  });

  it.each([{components:[]},{components:['tool','tool']},{components:['unknown']}])('refuses invalid component selection %j without creating a package',async ({components})=>{
    const f=await fixture();
    expect((await f.core.invokeTool('plugin_dev',{action:'init',name:'invalid-suite',components})).ok).toBe(false);
    await expect(readFile(join(f.cwd,'.agent-compositor/plugins/invalid-suite/plugin.json'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await f.core.invokeTool('plugin_dev',{action:'init',name:'invalid-suite',kind:'tool',components:['skill']})).ok).toBe(false);
  });

  it('refreshes plugin skill discovery and descriptions on reload, and removes disabled plugin skills from future prompts', async () => {
    const f = await fixture([{text:'Before'},{text:'Added'},{text:'Edited'},{text:'Disabled'}]);
    await f.core.submit('List capabilities');
    expect(systems(f.provider.requests[0])).not.toContain('local-workflow:');
    await f.core.invokeTool('plugin_dev',{action:'init',name:'local-workflow',kind:'skill'});
    expect((await f.core.invokeTool('skills',{name:'local-workflow'})).ok).toBe(false);
    await f.app.reloadPlugins(f.core);
    await f.core.submit('After reload');
    expect(systems(f.provider.requests[1])).toContain('local-workflow:');
    const path=join(f.cwd,'.agent-compositor/plugins/local-workflow/skills/local-workflow/SKILL.md');
    await writeFile(path,'---\nname: local-workflow\ndescription: Updated workflow description\n---\nUpdated procedure.');
    await f.app.reloadPlugins(f.core); await f.core.submit('After edit');
    expect(systems(f.provider.requests[2])).toContain('Updated workflow description');
    expect(await f.core.invokeTool('skills',{name:'local-workflow'})).toMatchObject({ok:true,output:{body:'Updated procedure.'}});
    expect((await f.core.invokeTool('extension_control',{action:'disable',name:'local-workflow',scope:'project'})).ok).toBe(true);
    await f.app.reloadPlugins(f.core); await f.core.submit('After disable');
    expect(systems(f.provider.requests[3])).not.toContain('local-workflow:');
    expect((await f.core.invokeTool('skills',{name:'local-workflow'})).ok).toBe(false);
  });

  it('gives project skills priority over bundled skills and keeps disabled discovery off', async () => {
    const f = await fixture([{text:'Use local guidance'}]);
    const directory=join(f.cwd,'.agents/skills/create-plugin');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'SKILL.md'),'---\nname: create-plugin\ndescription: Local authoring rules\n---\nUse local conventions.');
    await f.core.submit('Create an extension');
    expect(systems(f.provider.requests[0])).toContain('create-plugin: Local authoring rules');
    expect(await f.core.invokeTool('skills',{name:'create-plugin'})).toMatchObject({ok:true,output:{source:'agents',body:'Use local conventions.'}});
    const disabled=await fixture([{text:'No skills'}],{agent:{skills:false,projectContext:false}});
    await disabled.core.submit('An ordinary request');
    expect(systems(disabled.provider.requests[0])).not.toContain('Available skills');
    expect(disabled.core.getToolNames()).not.toContain('skills');
  });

  it('does not advertise skills or tools from an excluded plugin', async () => {
    const f=await fixture([{text:'No author'}],{enabledPlugins:[]});
    await f.core.submit('Inspect');
    expect(systems(f.provider.requests[0])).not.toContain('create-plugin:');
    expect(f.core.getToolNames()).not.toContain('plugin_dev');
    expect((await f.core.invokeTool('skills',{name:'create-plugin'})).ok).toBe(false);
  });

  it('returns installed event schemas and rejects unknown or path-like guide topics', async () => {
    const f=await fixture();
    expect(await f.core.invokeTool('plugin_dev',{action:'guide',topic:'events',event:'tool.check'})).toMatchObject({ok:true,output:{catalogVersion:CATALOG_VERSION,name:'tool.check',input:{type:'object'}}});
    expect((await f.core.invokeTool('plugin_dev',{action:'guide',topic:'../../outside'})).ok).toBe(false);
    expect((await f.core.invokeTool('plugin_dev',{action:'guide',topic:'events',event:'invented.event'})).ok).toBe(false);
  });

  it('never overwrites an existing extension or writes outside attached workspaces', async () => {
    const f=await fixture();
    const first=await f.core.invokeTool('plugin_dev',{action:'init',name:'preserved'});
    const path=(first.output as any).path;await writeFile(join(path,'hooks.ts'),'CUSTOM CONTENT');
    expect((await f.core.invokeTool('plugin_dev',{action:'init',name:'preserved'})).ok).toBe(false);
    expect(await readFile(join(path,'hooks.ts'),'utf8')).toBe('CUSTOM CONTENT');
    expect((await f.core.invokeTool('plugin_dev',{action:'init',name:'outside',path:'../outside'})).ok).toBe(false);
    expect((await f.core.invokeTool('plugin_dev',{action:'init',name:'../../escape'})).ok).toBe(false);
    expect((await f.core.invokeTool('plugin_dev',{action:'check',path:'../home'})).ok).toBe(false);
  });

  it('honors explicit permission denial before creating files', async () => {
    const f=await fixture([],{permissions:{rules:[{tool:'plugin_dev',decision:'deny'}]}});
    expect(await f.core.invokeTool('plugin_dev',{action:'init',name:'denied'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
    expect(f.events.some(e=>e.event==='tool.result'&&e.input.tool==='plugin_dev'&&e.input.denied===true)).toBe(true);
    await expect(readFile(join(f.cwd,'.agent-compositor/plugins/denied/plugin.json'))).rejects.toMatchObject({code:'ENOENT'});
  });

  it('does not start a contributed MCP server before a permitted call',async()=>{
    const f=await fixture([],{permissions:{rules:[{tool:'mcp_call',decision:'deny'}]}});
    const result=await f.core.invokeTool('plugin_dev',{action:'init',name:'guarded-mcp',kind:'mcp'});
    const path=(result.output as any).path,marker=join(f.cwd,'started');
    await writeFile(join(path,'.mcp.json'),JSON.stringify({mcpServers:{local:{command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`]}}}));
    expect(await f.core.invokeTool('plugin_dev',{action:'check',path})).toMatchObject({ok:true,output:{valid:true,executed:false}});
    await f.app.reloadPlugins(f.core);
    expect(await f.core.invokeTool('mcp_call',{action:'call',server:'guarded-mcp-local',tool:'ping'})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
    await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
  });

  it('checks structure without importing code and reports missing or escaping entries and skill headers', async () => {
    const f=await fixture();
    const result=await f.core.invokeTool('plugin_dev',{action:'init',name:'checked'});const path=(result.output as any).path;
    await writeFile(join(path,'hooks.ts'),"throw Error('Never import this during a structure check');");
    expect(await f.core.invokeTool('plugin_dev',{action:'check',path})).toMatchObject({ok:true,output:{valid:true,executed:false}});
    await mkdir(join(path,'skills/bad'),{recursive:true});await writeFile(join(path,'skills/bad/SKILL.md'),'No header');
    expect(await f.core.invokeTool('plugin_dev',{action:'check',path})).toMatchObject({ok:true,output:{valid:false,errors:expect.arrayContaining([expect.stringContaining('Skill needs')])}});
    await rm(join(path,'hooks.ts'));await symlink(join(f.root,'outside.ts'),join(path,'hooks.ts'));await writeFile(join(f.root,'outside.ts'),'export default {};');
    expect((await f.core.invokeTool('plugin_dev',{action:'check',path})).ok).toBe(false);
    await rm(join(path,'hooks.ts'));
    expect(await f.core.invokeTool('plugin_dev',{action:'check',path})).toMatchObject({ok:true,output:{valid:false,errors:expect.arrayContaining([expect.stringContaining('declared main')])}});
  });

  it('shows command help without a model call and does not consume similarly prefixed prompts', async () => {
    const f=await fixture([{text:'Unrelated'}]);
    await f.core.submit('/plugin');expect(f.provider.requests).toHaveLength(0);
    await f.core.submit('/plugin-other');expect(f.provider.requests).toHaveLength(1);
    expect(f.provider.requests[0].messages.find(m=>m.role==='user')?.content).toBe('/plugin-other');
  });
});
