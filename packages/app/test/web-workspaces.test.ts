import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider,AgentCore} from '@agent-compositor/core';
import {WorkspaceAccess,UndoStore} from '@agent-compositor/tools';
import {buildApp} from '../src/build.js';
import {activeReference,referenceFiles,expandReferences} from '../src/project-context.js';
import {searchWeb,fetchPage,duckResults} from '../../../plugins/web/tools.js';

const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(config:Record<string,unknown>={},steps:ConstructorParameters<typeof ScriptedProvider>[0]=[{text:"done"},{text:"continued"}],hub=false){
  const root=await mkdtemp(join(tmpdir(),'ac-web-workspaces-'));roots.push(root);
  const cwd=join(root,'primary'),home=join(root,'home'),other=join(home,'other project');
  await mkdir(cwd);await mkdir(other,{recursive:true});await mkdir(join(cwd,'.agent-compositor'));
  await writeFile(join(cwd,'.agent-compositor/callix.json'),'{"background":false}');
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['web','callix','agent-harness'],agent:{skills:false,controlTools:[],projectContext:false},...config}));
  await writeFile(join(other,'hello.txt'),'External project evidence');await writeFile(join(other,'sibling.txt'),'Sibling evidence');await writeFile(join(other,'AGENTS.md'),'External project conventions');
  const provider=new ScriptedProvider(steps);
  const app=await buildApp({cwd,env:{HOME:home},provider,agentHub:hub,pluginDirs:[join(process.cwd(),'plugins')]});apps.push(app);
  return{root,cwd,home,other,provider,app,core:app.createCore(async()=>true)};
}
describe('multiple attached projects',()=>{
  it.each(['sibling','symlink'] as const)('returns a %s scope violation to the model without terminating the turn',async kind=>{
    const path=kind==='sibling'?'~/other project/sibling.txt':'link.txt';
    const f=await fixture({},[
      {toolCalls:[{name:'read',args:{path}}]},
      {text:'Access blocked; no bypass attempted'},
    ]);
    await f.core.workspace.add(join(f.other,'hello.txt'));
    if(kind==='symlink')await symlink(join(f.other,'sibling.txt'),join(f.cwd,path));
    const results:any[]=[];
    f.core.subscribe(event=>{if(event.kind==='catalog'&&event.event==='tool.result')results.push(event.input);});
    await f.core.submit('Attempt the selected read once, then report any boundary');
    expect(f.core.failure).toBeUndefined();
    expect(f.provider.requests).toHaveLength(2);
    expect(results).toContainEqual(expect.objectContaining({callId:expect.any(String),tool:'read',ok:false,denied:true,error:expect.stringContaining('Path escapes attached workspaces')}));
    const messages=f.provider.requests[1].messages;
    expect(messages.find(message=>message.role==='tool')?.content).toContain('Permission denied');
    expect(JSON.stringify(messages)).not.toContain('Sibling evidence');
    expect(f.core.getMessages().at(-1)?.content).toContain('Access blocked');
  });

  it.each(['user','agent'] as const)('preserves %s origin for references queued behind another turn',async source=>{
    const f=await fixture({},[{hold:true},{text:'Queued turn completed'}]);
    const running=f.core.submit('Hold the first turn',source==='user'?'agent':'user');
    await vi.waitFor(()=>expect(f.provider.requests).toHaveLength(1));
    await f.core.submit('Inspect @"~/other project/hello.txt"',source);
    f.provider.release();await running;
    expect(f.provider.requests).toHaveLength(2);
    const user=f.provider.requests[1].messages.filter(message=>message.role==='user').at(-1)!.content;
    if(source==='user'){expect(user).toContain('External project evidence');expect(f.core.workspace.list()).toHaveLength(2);}
    else{expect(user).not.toContain('External project evidence');expect(f.core.workspace.list()).toHaveLength(1);}
  });

  it('does not let a delegated task run workspace grant commands against its parent',async()=>{
    const f=await fixture({agent:{skills:false,controlTools:['task'],projectContext:false}},[
      {toolCalls:[{name:'task',args:{prompt:'/workspace add "~/other project"'}}]},
      {text:'Parent completed'},
    ]);
    await f.core.submit('Delegate a task without selecting another project');
    expect(f.core.failure).toBeUndefined();expect(f.core.workspace.list()).toHaveLength(1);
    expect(f.provider.requests).toHaveLength(2);
    const taskResult=f.core.getMessages().find(message=>message.role==='tool'&&message.name==='task');
    expect(JSON.parse(taskResult!.content)).toMatchObject({agentId:expect.any(String)});
    expect((await f.core.invokeTool('read',{path:join(f.other,'hello.txt')})).ok).toBe(false);
  });

  it('applies a canonical path denial when a symlink points into an otherwise attached project',async()=>{
    const f=await fixture({workspacePaths:['~/other project'],permissions:{rules:[{tool:'read',path:'/**/hello.txt',decision:'deny'}]}});
    await symlink(join(f.other,'hello.txt'),join(f.cwd,'alias.txt'));
    const result=await f.core.invokeTool('read',{path:'alias.txt'});
    expect(result.ok).toBe(false);expect(result.error).toContain('denied');
  });

  it('does not grant or embed file references when the composition disables them',async()=>{
    const f=await fixture({agent:{skills:false,controlTools:[],projectContext:false,fileReferences:false}});
    await f.core.submit('Keep @"~/other project/hello.txt" literal');
    expect(f.provider.requests[0].messages.find(message=>message.role==='user')!.content).toBe('Keep @"~/other project/hello.txt" literal');
    expect(f.core.workspace.list()).toHaveLength(1);
  });

  it('expands home, absolute, quoted and parent paths; a file grant does not grant siblings',async()=>{
    const f=await fixture(),file=join(f.other,'hello.txt');
    await f.core.submit('Inspect @"~/other project/hello.txt"');
    const user=f.provider.requests[0].messages.find(message=>message.role==='user')!.content;
    expect(user).toContain(file);expect(user).toContain('External project evidence');expect(user).not.toContain('External project conventions');
    expect(await f.core.invokeTool('read',{path:'~/other project/hello.txt'})).toMatchObject({ok:true,output:{content:'External project evidence'}});
    expect((await f.core.invokeTool('read',{path:join(f.other,'sibling.txt')})).ok).toBe(false);
    await f.core.submit(`Compare @"${f.other}" with @.`);
    expect(f.provider.requests[1].messages.at(-1)?.content).toContain('External project conventions');
    expect((await f.core.invokeTool('read',{path:join(f.other,'sibling.txt')})).ok).toBe(true);
    const expanded=await expandReferences(f.cwd,'Use @"../home/other project/hello.txt"',{workspace:f.core.workspace});expect(expanded.text).toContain('External project evidence');
  });
  it('uses attached cwd for search and shell, retains normal write approvals and restores grants on resume',async()=>{
    const f=await fixture();await f.core.submit('/workspace add "~/other project"');
    expect(f.provider.requests).toHaveLength(0);
    expect(await f.core.invokeTool('glob',{cwd:'~/other project',pattern:'*.txt'})).toMatchObject({ok:true,output:{files:['hello.txt','sibling.txt']}});
    expect(await f.core.invokeTool('grep',{cwd:f.other,pattern:'Sibling'})).toMatchObject({ok:true,output:{matches:[{path:'sibling.txt'}]}});
    expect(await f.core.invokeTool('exec',{cwd:'~/other project',command:'pwd'})).toMatchObject({ok:true,output:{exitCode:0}});
    expect(await f.core.invokeTool('write',{path:'~/other project/new.txt',content:'Created across projects'})).toMatchObject({ok:true});expect(await readFile(join(f.other,'new.txt'),'utf8')).toBe('Created across projects');
    const resumed=await f.app.resume(f.core.sessionId,async()=>false);
    expect((await resumed.invokeTool('read',{path:'~/other project/new.txt'})).ok).toBe(true);
    expect((await resumed.invokeTool('write',{path:'~/other project/new.txt',content:'denied'})).ok).toBe(false);
    await resumed.submit('/workspace remove "~/other project"');expect((await resumed.invokeTool('read',{path:join(f.other,'hello.txt')})).ok).toBe(false);
  });
  it('rejects unselected roots and symlink escapes, and honors explicit read denials for attachments',async()=>{
    const f=await fixture({permissions:{rules:[{tool:'read',path:'/**/hello.txt',decision:'deny'}]}});
    await f.core.submit('Inspect @"~/other project/hello.txt"');
    expect(f.provider.requests[0].messages.find(message=>message.role==='user')!.content).toContain('denied');
    expect(f.provider.requests[0].messages.find(message=>message.role==='user')!.content).not.toContain('External project evidence');
    const secret=join(f.root,'secret.txt');await writeFile(secret,'outside');await symlink(secret,join(f.cwd,'link.txt'));
    expect((await f.core.invokeTool('read',{path:'link.txt'})).ok).toBe(false);
    expect((await f.core.invokeTool('exec',{cwd:f.root,command:'pwd'})).ok).toBe(false);
  });
  it('inherits the selected filesystem scope in a delegated task',async()=>{
    const f=await fixture({agent:{skills:false,controlTools:['task'],projectContext:false}},[
      {toolCalls:[{name:'task',args:{prompt:'Read ~/other project/hello.txt'}}]},
      {toolCalls:[{name:'read',args:{path:'~/other project/hello.txt'}}]},
      {text:'External child evidence verified'},{text:'Delegation completed'},
    ]);
    await f.core.submit('Inspect @"~/other project" with a delegated task');
    expect(f.core.failure).toBeUndefined();
    expect(f.provider.requests.some(request=>request.messages.some(message=>message.role==='tool'&&message.content.includes('External project evidence')))).toBe(true);
  });
  it('runs independent agents in two selected projects concurrently',async()=>{
    const f=await fixture({enabledPlugins:['agent-harness','agent-hub'],workspacePaths:['../home/other project'],agent:{skills:false,controlTools:[],projectContext:false}},[],true);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.spyOn(f.provider,'complete').mockImplementation(async function*(request){
      f.provider.requests.push(request);
      await Promise.race([gate,new Promise<void>(resolve=>{if(request.signal.aborted)resolve();else request.signal.addEventListener('abort',()=>resolve(),{once:true});})]);
      if(request.signal.aborted)return;
      yield{type:'text_delta' as const,text:'Concurrent project completed'};yield{type:'finish' as const,reason:'stop' as const};
    });
    await f.core.submit('/workspace add "~/other project"');
    const a=await f.core.invokeTool('agent_control',{action:'create',name:'project-a',cwd:f.cwd,worktree:false});
    const b=await f.core.invokeTool('agent_control',{action:'create',name:'project-b',cwd:'~/other project',worktree:false});
    expect(a.ok,a.error).toBe(true);expect(b.ok,b.error).toBe(true);const aid=(a.output as any).id,bid=(b.output as any).id;
    await f.core.invokeTool('agent_control',{action:'send',id:aid,prompt:'Work on A'});
    await f.core.invokeTool('agent_control',{action:'send',id:bid,prompt:'Work on B'});
    await vi.waitFor(async()=>{const result=(await f.core.host.emit('service.agent.control',{action:'list'})).value as any;
      expect(result.value.filter((row:any)=>row.state==='running')).toHaveLength(2);
      expect(result.value.find((row:any)=>row.id===bid).cwd).toBe(f.other);
    });
    await vi.waitFor(()=>expect(f.provider.requests).toHaveLength(2));release();
    await vi.waitFor(async()=>{const result=(await f.core.host.emit('service.agent.control',{action:'list'})).value as any;expect(result.value.every((row:any)=>row.state==='idle')).toBe(true);});
    expect(f.provider.requests).toHaveLength(2);
    expect((await f.core.invokeTool('agent_control',{action:'create',cwd:f.root,worktree:false})).ok).toBe(false);
  });
  it('does not turn model-authored references or workspace commands into new grants',async()=>{
    const f=await fixture();
    await f.core.submit('Inspect @"~/other project/hello.txt"','agent');
    expect(f.core.workspace.list()).toHaveLength(1);
    expect(f.provider.requests[0].messages.find(message=>message.role==='user')!.content).not.toContain('External project evidence');
    await f.core.submit('/workspace add "~/other project"','agent');expect(f.core.workspace.list()).toHaveLength(1);
  });
  it('keeps replacement resource tools independent of the local filesystem scope',async()=>{
    const f=await fixture();
    const core=new AgentCore({cwd:f.cwd,provider:new ScriptedProvider([]),controlTools:[],tools:[{
      name:'read',description:'Read a provider resource',parameters:{},describe:(args:any)=>({tool:'read',path:args.path}),
      execute:async(_ctx,args:any)=>({ok:true,data:{resource:args.path}}),
    }]});
    expect(await core.invokeTool('read',{path:'/provider/virtual/resource'})).toMatchObject({ok:true,output:{resource:'/provider/virtual/resource'}});
  });
  it('journals startup directory grants before resumption without repeating CLI/config selection',async()=>{
    const f=await fixture({workspacePaths:['~/other project']});await f.core.start();
    const stored=await f.app.store.load(f.core.sessionId,f.cwd);
    expect(stored.events.some(event=>event.type==='workspace.changed'&&(event.roots as any[]).some(entry=>entry.path===f.other))).toBe(true);
    const resumed=AgentCore.resume({cwd:f.cwd,homeDir:f.home,provider:new ScriptedProvider([])},stored.events);
    expect((await resumed.invokeTool('read',{path:'~/other project/hello.txt'})).ok).toBe(true);
  });
  it('completes quoted home paths without granting access and lists the project root directory',async()=>{
    const f=await fixture(),workspace=new WorkspaceAccess(f.cwd,f.home);
    expect(activeReference('Read @"~/other project/he')).toMatchObject({prefix:'~/other project/he',start:5});
    expect(await referenceFiles(workspace,'~/other project/he')).toEqual(['~/other project/hello.txt']);
    expect(await referenceFiles(workspace,'~/other')).toContain('~/other project/');
    expect(workspace.list()).toHaveLength(1);await expect(workspace.resolve(join(f.other,'hello.txt'))).rejects.toThrow('escapes');
    await writeFile(join(f.cwd,'local.txt'),'local');expect((await expandReferences(f.cwd,'List @.')).text).toContain('local.txt');
  });
});

const html='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=x">Official &amp; docs</a><a class="result__snippet">Read <b>the docs</b> &#x2713;</a></div>';
function webContext(fetcher:typeof fetch,config:unknown={}){return{cwd:'/tmp',signal:new AbortController().signal,undo:new UndoStore(),request:async()=>null as any,settings:async()=>config,fetch:fetcher};}
describe('internet tools without mandatory credentials',()=>{
  it('searches without a key, decodes real DuckDuckGo links and never reports a challenge as zero results',async()=>{
    vi.stubEnv('BRAVE_SEARCH_API_KEY','');const fetcher=vi.fn(async()=>new Response(html,{headers:{'content-type':'text/html'}})) as unknown as typeof fetch;
    const result=await searchWeb(webContext(fetcher),{query:'official docs',count:3});
    expect(result).toMatchObject({provider:'duckduckgo',results:[{url:'https://example.com/docs',title:'Official & docs',snippet:'Read the docs ✓'}]});
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain('html.duckduckgo.com');
    expect(()=>duckResults('<form id="challenge-form">human check</form>',5)).toThrow('human challenge');
    expect(()=>duckResults('<html>changed markup</html>',5)).toThrow('unrecognized');
    expect(duckResults('<div class="no-results">No results found</div>',5)).toEqual([]);
  });
  it('keeps explicit providers authoritative and supports existing SearXNG settings',async()=>{
    vi.stubEnv('BRAVE_SEARCH_API_KEY','');const fetcher=vi.fn(async()=>Response.json({results:[{title:'Docs',url:'https://example.com/docs',content:'Reference'}]})) as unknown as typeof fetch;
    await expect(searchWeb(webContext(fetcher,{provider:'brave'}),{query:'docs'})).rejects.toThrow('requires BRAVE');expect(fetcher).not.toHaveBeenCalled();
    expect(await searchWeb(webContext(fetcher,{searchUrl:'https://search.example/search'}),{query:'docs'})).toMatchObject({provider:'searxng',results:[{url:'https://example.com/docs'}]});
    await expect(searchWeb(webContext(fetcher),{query:'',count:0})).rejects.toThrow('Invalid');
  });
  it('loads internet tools into the real harness and keeps network denials binding',async()=>{
    vi.stubEnv('BRAVE_SEARCH_API_KEY','');const f=await fixture();
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>new Response(String(input).includes('duckduckgo')?html:'<h1>Fetched source</h1>',{headers:{'content-type':'text/html'}}));
    expect(f.core.getToolNames()).toEqual(expect.arrayContaining(['web_search','web_fetch']));
    expect(await f.core.invokeTool('web_search',{query:'official docs'})).toMatchObject({ok:true,output:{provider:'duckduckgo'}});
    expect(await f.core.invokeTool('web_fetch',{url:'https://example.com/docs'})).toMatchObject({ok:true,output:{text:'Fetched source'}});
    const count=fetcher.mock.calls.length,denied=f.app.createCore(async()=>false);
    expect((await denied.invokeTool('web_search',{query:'do not send'})).ok).toBe(false);expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('returns readable page content and safe source links through the supplied network client',async()=>{
    const fetcher=vi.fn(async()=>new Response('<title>API &amp; SDK</title><script>unsafe()</script><h1>Docs</h1><a href="/reference">Reference</a><a href="javascript:bad()">bad</a>',{headers:{'content-type':'text/html'}})) as unknown as typeof fetch;
    const result=await fetchPage('https://example.com/docs',new AbortController().signal,fetcher);
    expect(result).toMatchObject({title:'API & SDK',links:[{url:'https://example.com/reference',title:'Reference'}]});expect(result.text).not.toContain('unsafe');
  });
});
