// Exercise the release exactly as an end user, outside the source tree.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, access, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { GifWriter } from 'omggif';
import assert from 'node:assert/strict';
import { callixRelease } from '../../plugins/callix/distribution.mjs';
import { smokeContextTask } from './context-smoke.mjs';
import { smokeBackgroundTask } from './background-smoke.mjs';
import { smokeApprovals } from './approval-smoke.mjs';
import { smokePlainControls } from './plain-controls-smoke.mjs';
const exec = promisify(execFile);
// Permission rules and guarded edit anchors use canonical paths. macOS aliases
// /var to /private/var, so fixture allow rules must use the same physical path.
const temp = await realpath(await mkdtemp(join(tmpdir(), 'compositor-release-')));
const asset = `compositor-${process.platform}-${process.arch}.tar.gz`;
const archive = await readFile(resolve('dist/release', asset));
const digest = createHash('sha256').update(archive).digest('hex');
const expected = JSON.parse(await readFile('package.json')).version;
const installer = resolve('install.sh');
let corrupt = true;
let callixResult, workflowResult, guardedEditResult, modelRequests=0, startupProofPath, startupReviewed=false;
async function serve(req, res) {
  if (req.url.endsWith('/SHA256SUMS')) { res.end(`${corrupt ? '0'.repeat(64) : digest}  ${asset}\n`); return; }
  if (req.url.endsWith(`/${asset}`)) { res.end(archive); return; }
  if (req.url === '/v1/chat/completions') {
    modelRequests++;
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
    if(request.messages.some(m=>m.role==='user'&&m.content==='PLAIN_STARTUP_ORDER_CHECK')){
      assert.equal(JSON.parse(await readFile(startupProofPath,'utf8')).calls,2,'Startup must finish before the first model request');startupReviewed=true;
      res.end(frame({content:'PLAIN_STARTUP_VERIFIED'},'stop')+'data: [DONE]\n\n');return;
    }
    if(request.messages.some(m=>m.role==='user'&&m.content==='AUTHOR_DISTRIBUTION_CHECK')) {
      assert.ok(request.tools.some(tool=>tool.function.name==='plugin_dev'));
      assert.ok(request.messages.some(m=>m.role==='system'&&m.content.includes('create-plugin:')));
      const last=request.messages.filter(m=>m.role==='tool').at(-1);
      const call=(name,args)=>res.end(frame({tool_calls:[{index:0,id:'author-'+request.messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls')+'data: [DONE]\n\n');
      if(!last)call('skills',{name:'create-plugin'});
      else if(JSON.parse(last.content).name==='create-plugin'){assert.match(JSON.parse(last.content).body,/Create a Compositor plugin/);call('plugin_dev',{action:'guide',topic:'events',event:'tool.check'});}
      else {
        const result=JSON.parse(last.content);
        if(result.catalogVersion)call('plugin_dev',{action:'init',name:'release-addon',components:['command','panel','tool','service','skill','mcp']});
        else if(result.activated===false)call('plugin_dev',{action:'check',path:result.path});
        else {assert.equal(result.valid,true);assert.equal(result.executed,false);assert.deepEqual(result.skills,['release-addon']);assert.deepEqual(result.mcpServers,['release-addon-local']);res.end(frame({content:'AUTHOR_DISTRIBUTION_OK'},'stop')+'data: [DONE]\n\n');}
      }
      return;
    }
    if(request.messages.some(m=>m.role==='user'&&m.content==='AUTHOR_TOOL_CHECK')) {
      const last=request.messages.filter(m=>m.role==='tool').at(-1);
      if(!last)res.end(frame({tool_calls:[{index:0,id:'authored-tool',type:'function',function:{name:'release_addon',arguments:'{}'}}]},'tool_calls')+'data: [DONE]\n\n');
      else {assert.equal(JSON.parse(last.content).marker,'AUTHORED_SDK_OK');res.end(frame({content:'AUTHOR_TOOL_OK'},'stop')+'data: [DONE]\n\n');}
      return;
    }
    if(request.messages.some(m=>m.role==='user'&&m.content==='AUTHOR_COMPOSITE_CHECK')) {
      const last=request.messages.filter(m=>m.role==='tool').at(-1);
      const call=(name,args)=>res.end(frame({tool_calls:[{index:0,id:'composite-'+request.messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls')+'data: [DONE]\n\n');
      assert.ok(request.messages.some(m=>m.role==='system'&&m.content.includes('Help the user with the selected domain')));
      if(!last)call('skills',{name:'release-addon'});
      else if(JSON.parse(last.content).name==='release-addon')call('mcp_call',{action:'call',server:'release-addon-local',tool:'ping'});
      else {assert.equal(JSON.parse(last.content).content[0].text,'release-addon MCP ready');res.end(frame({content:'AUTHOR_COMPOSITE_OK'},'stop')+'data: [DONE]\n\n');}
      return;
    }
    if(request.messages.filter(m=>m.role==='user').at(-1)?.content.startsWith('MULTIPROJECT_READ')){
      const last=request.messages.at(-1);
      if(last?.role==='tool')res.end(frame({content:JSON.parse(last.content).content==='INSTALLED_MULTI_PROJECT_EVIDENCE'?'MULTIPROJECT_READ_OK':'MULTIPROJECT_READ_FAILED'},'stop')+'data: [DONE]\n\n');
      else res.end(frame({tool_calls:[{index:0,id:'workspace-read-'+request.messages.length,type:'function',function:{name:'read',arguments:JSON.stringify({path:'~/external projects/evidence.txt'})}}]},'tool_calls')+'data: [DONE]\n\n');
    } else if(request.messages.some(m=>m.role==='user'&&m.content.startsWith('WORKFLOW_WORKER_CHECK'))){
      res.end(frame({content:'WORKFLOW_WORKER_OK'},'stop')+'data: [DONE]\n\n');
    } else if(request.messages.some(m=>m.role==='user'&&m.content==='WORKFLOW_DISTRIBUTION_CHECK')){
      const tool=request.messages.filter(m=>m.role==='tool').at(-1);
      if(!tool)res.end(frame({tool_calls:[{index:0,id:'workflow-start',type:'function',function:{name:'workflow_run',arguments:JSON.stringify({action:'start',title:'Packaged workflow',stages:[{id:'worker',prompt:'WORKFLOW_WORKER_CHECK'}]})}}]},'tool_calls')+'data: [DONE]\n\n');
      else {const run=JSON.parse(tool.content);if(run.status==='completed'){workflowResult=run;res.end(frame({content:'WORKFLOW_DISTRIBUTION_OK'},'stop')+'data: [DONE]\n\n');}
      else res.end(frame({tool_calls:[{index:0,id:'workflow-status-'+request.messages.length,type:'function',function:{name:'workflow_run',arguments:JSON.stringify({action:'status',id:run.id,waitMs:1000})}}]},'tool_calls')+'data: [DONE]\n\n');}
    } else if(request.messages.some(m=>m.role==='user'&&m.content==='CALLIX_SYMBOL_EDIT_CHECK')){
      const tool=request.messages.filter(m=>m.role==='tool').at(-1);
      if(!tool)res.end(frame({tool_calls:[{index:0,id:'symbol-read',type:'function',function:{name:'code_query',arguments:JSON.stringify({action:'read_symbol',pattern:'leaf',path:'leaf.ts'})}}]},'tool_calls')+'data: [DONE]\n\n');
      else if(JSON.parse(tool.content).edit){const source=JSON.parse(tool.content);res.end(frame({tool_calls:[{index:0,id:'symbol-edit',type:'function',function:{name:'edit',arguments:JSON.stringify({...source.edit,oldText:'value + 1',newText:'value + 2'})}}]},'tool_calls')+'data: [DONE]\n\n');}
      else{guardedEditResult=JSON.parse(tool.content);res.end(frame({content:'CALLIX_SYMBOL_EDIT_OK'},'stop')+'data: [DONE]\n\n');}
    } else if (request.messages.some(m => m.role === 'user' && m.content === 'CALLIX_DISTRIBUTION_CHECK')) {
      const tool = request.messages.filter(m => m.role === 'tool').at(-1);
      if (!tool) {
        res.end(frame({ tool_calls: [{ index: 0, id: 'callix-check', type: 'function', function: { name: 'code_query', arguments: JSON.stringify({ action: 'callers', pattern: 'leaf' }) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
      } else {
        try { callixResult = JSON.parse(tool.content); } catch { callixResult = { error: tool.content }; }
        res.end(frame({ content: 'CALLIX_TOOL_RETURNED' }, 'stop') + 'data: [DONE]\n\n');
      }
    } else res.end(frame({ content: 'RELEASE_SMOKE_OK' }, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  res.writeHead(404); res.end();
}
const server = createServer((req, res) => { void serve(req, res).catch(error => res.destroy(error)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const prefix = join(temp, 'install with spaces');
const project = join(temp, 'project'), home = join(temp, 'home');
await mkdir(project); await mkdir(home);
const env = { ...process.env, HOME: home, AGENT_HOME: join(home, '.agent-compositor'), AGENT_BASE_URL: `${base}/v1`, AGENT_MODEL: 'release-smoke', AGENT_API_KEY: '', COMPOSITOR_RELEASE_BASE_URL: `${base}/releases` };
try {
  const options = { env, cwd: project, timeout: 60000, maxBuffer: 2_000_000 };
  if (process.platform === 'linux') {
    const oldLibc = join(temp, 'old-libc');
    await mkdir(oldLibc);
    await writeFile(join(oldLibc, 'getconf'), "#!/bin/sh\nprintf 'glibc 2.35\\n'\n", { mode: 0o755 });
    await assert.rejects(exec('sh', [installer, '--prefix', prefix], { ...options, env: { ...env, PATH: `${oldLibc}:${env.PATH}` } }), /requires glibc 2.38/);
  }
  await assert.rejects(exec('sh', [installer, '--prefix', prefix], options), /Checksum mismatch/);
  await assert.rejects(access(join(prefix, 'bin/compositor')));
  corrupt = false;
  await exec('sh', [installer, '--version', `v${expected}`, '--prefix', prefix], options);
  const binary = join(prefix, 'bin/compositor');
  assert.equal((await exec(binary, ['--version'], options)).stdout.trim(), `compositor ${expected}`);
  const approvalSmoke=await smokeApprovals(binary,resolve('dist/release',`approval-smoke-${process.platform}-${process.arch}.json`));
  console.log('Installed structured approval/refusal:',JSON.stringify(approvalSmoke));
  const plainControls=await smokePlainControls(binary,resolve('dist/release',`plain-controls-smoke-${process.platform}-${process.arch}.json`));
  console.log('Installed plain controls and raw approval:',JSON.stringify(plainControls));
  const contextSmoke=await smokeContextTask(binary,resolve('dist/release',`context-smoke-${process.platform}-${process.arch}.json`));
  const backgroundSmoke=await smokeBackgroundTask(binary,resolve('dist/release',`background-smoke-${process.platform}-${process.arch}.json`));
  console.log('Installed background task retention:',JSON.stringify(backgroundSmoke));
  console.log(`Installed binary context smoke passed: ${JSON.stringify(contextSmoke)}`);
  assert.match((await exec(binary, ['--help'], options)).stdout, /--plugins/);
  const plain = exec(binary, ['--plain'], options);
  // EOF exits the line interface without contacting a model.
  plain.child.stdin.end();
  const { stdout } = await plain;
  assert.doesNotMatch(stdout, /plugin load errors/);
  for (const name of ['mascot', 'monty', 'callix', 'todos', 'ui-theme', 'mcp', 'workflows', 'plugin-author']) assert.doesNotMatch(stdout, new RegExp(`${name}@`));
  const startupProject=join(temp,'plain-startup-project'),startupPlugin=join(temp,'plain-startup-plugin');
  await mkdir(startupProject);await mkdir(startupPlugin);startupProofPath=join(startupProject,'.agent-compositor/startup-proof.json');
  await writeFile(join(startupProject,'agent-compositor.json'),JSON.stringify({enabledPlugins:['plain-startup-probe'],agent:{tools:[],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false}}));
  await writeFile(join(startupPlugin,'plugin.json'),JSON.stringify({name:'plain-startup-probe',version:'1.0.0',main:'hooks.js',trust:'trusted',capabilities:['session.start'],compositor:{standard:1,apiVersion:1}}));
  await writeFile(join(startupPlugin,'hooks.js'),`export default {'session.start':async(_,$)=>{const previous=await $.storage.config('startup-proof.json');await $.storage.configure('startup-proof.json',{calls:(previous.calls??0)+1},'project');}};`);
  const startupOptions={...options,cwd:startupProject,env:{...env,AGENT_STORAGE_MODE:'project'}},beforeStartup=modelRequests;
  const emptyStartup=exec(binary,['--plain','--plugins',startupPlugin],startupOptions);emptyStartup.child.stdin.end();await emptyStartup;
  assert.equal(modelRequests,beforeStartup,'EOF must not submit a model prompt');assert.equal(JSON.parse(await readFile(startupProofPath,'utf8')).calls,1);
  const promptedStartup=exec(binary,['--plain','--plugins',startupPlugin],startupOptions);promptedStartup.child.stdin.end('PLAIN_STARTUP_ORDER_CHECK\r');
  assert.match((await promptedStartup).stdout,/PLAIN_STARTUP_VERIFIED/);assert.equal(startupReviewed,true);assert.equal(JSON.parse(await readFile(startupProofPath,'utf8')).calls,2);
  assert.equal(modelRequests,beforeStartup+1);
  const startupReport={ok:true,processes:2,startupHooks:2,emptyInputModelRequests:0,firstRequestSawStartup:startupReviewed,modelRequests:modelRequests-beforeStartup};
  await writeFile(resolve('dist/release',`plain-startup-smoke-${process.platform}-${process.arch}.json`),JSON.stringify(startupReport,null,2)+'\n');
  console.log('Installed plain startup:',JSON.stringify(startupReport));
  const marketplaces=await exec(binary,['-p','/marketplace','--output-format','stream-json'],options);
  assert.match(marketplaces.stdout,/agent-compositor/);
  // Positive feature probes explicitly choose their packages in project scope.
  await writeFile(join(project,'agent-compositor.json'),JSON.stringify({enabledPlugins:['monty','workflows','callix','checkpoint-history','agent-harness','session-manager','extension-manager','marketplace-manager']}));
  const reply = await exec(binary, ['-p', 'Reply with the smoke marker'], options);
  assert.match(reply.stdout, /RELEASE_SMOKE_OK/);
  assert.match((await exec(binary,['-p','WORKFLOW_DISTRIBUTION_CHECK'],options)).stdout,/WORKFLOW_DISTRIBUTION_OK/);
  assert.equal(workflowResult?.stages?.[0]?.output,'WORKFLOW_WORKER_OK');
  // Test the packaged mascot decoder/assets and Monty bridge, not source modules.
  const [distribution] = (await readdir(join(prefix, 'share/agent-compositor'))).filter(name => name.startsWith(`v${expected}-`));
  const directory = join(prefix, 'share/agent-compositor', distribution);
  // A separately installed plugin version takes precedence over the app cache.
  const overrideProject=join(temp,'override-project'),overrideMarket=join(temp,'override-market');
  await mkdir(overrideProject);await mkdir(join(overrideMarket,'.claude-plugin'),{recursive:true});
  await cp(join(directory,'plugins/todos'),join(overrideMarket,'plugins/todos'),{recursive:true});
  const overrideManifest=JSON.parse(await readFile(join(overrideMarket,'plugins/todos/plugin.json'),'utf8'));overrideManifest.version='9.0.0';
  await writeFile(join(overrideMarket,'plugins/todos/plugin.json'),JSON.stringify(overrideManifest));
  await writeFile(join(overrideMarket,'.claude-plugin/marketplace.json'),JSON.stringify({name:'override-fixture',owner:{name:'Fixture'},plugins:[{name:'todos',version:'9.0.0',source:'./plugins/todos'}]}));
  await writeFile(join(overrideProject,'agent-compositor.json'),JSON.stringify({permissions:{rules:[{tool:'extension_control',decision:'allow'}]}}));
  const overrideOptions={...options,cwd:overrideProject};
  await exec(binary,['-p','/marketplace add '+overrideMarket+' --project'],overrideOptions);
  assert.match((await exec(binary,['-p','/extensions install todos@override-fixture --project','--output-format','stream-json'],overrideOptions)).stdout,/Installed todos v9.0.0/);
  await exec(binary,['-p','/extensions enable todos --project'],overrideOptions);
  const overridden=exec(binary,['--plain'],overrideOptions);overridden.child.stdin.end();assert.match((await overridden).stdout,/todos@9.0.0/);
  assert.match(await readFile(join(directory,'licenses/omggif/README'),'utf8'),/Permission is hereby granted/);
  const gifDirectory=join(project,'gif-assets');await mkdir(gifDirectory);
  const gifBytes=Buffer.alloc(1024),gif=new GifWriter(gifBytes,2,1,{palette:[0,0xff0000],loop:0});
  gif.addFrame(0,0,2,1,[1,1],{delay:2});gif.addFrame(0,0,2,1,[0,1],{delay:3,transparent:0});
  await writeFile(join(gifDirectory,'idle.gif'),gifBytes.subarray(0,gif.end()));
  const ghostVerify=join(temp,'verify-ghost.mjs');
  await writeFile(ghostVerify,`import hooks,{dispose}from ${JSON.stringify(pathToFileURL(join(directory,'plugins/mascot/hooks.js')).href)};
let image;const api={session:{id:'gif-release-check',cwd:${JSON.stringify(project)}},storage:{config:async()=>({pack:'gif-assets',animations:{idle:'idle.gif'}})},ui:{view:async(_id,_title,view)=>{image=view.raster;},notify:async(message,level)=>{if(level==='warn')throw Error(message);}}};
await hooks['session.start']({},api);dispose();if(image?.width!==2||image?.height!==1||Buffer.from(image.rgba,'base64')[0]!==255)throw Error('Packaged GIF decoder failed');console.log('GHOST_GIF_OK');`);
  assert.match((await exec(process.execPath,[ghostVerify],options)).stdout,/GHOST_GIF_OK/);
  const callixDirectory = join(directory, 'plugins/callix/bin');
  const provenance = JSON.parse(await readFile(join(callixDirectory, 'release.json'), 'utf8'));
  for (const [key, value] of Object.entries(callixRelease())) assert.equal(provenance[key], value);
  assert.equal(createHash('sha256').update(await readFile(join(callixDirectory, 'callix'))).digest('hex'), provenance.binarySha256);
  const license = await readFile(join(callixDirectory, 'LICENSE'));
  assert.equal(createHash('sha256').update(license).digest('hex'), provenance.licenseSha256);
  assert.match(license.toString('utf8'), /MIT License/);
  const noPath = join(temp, 'empty-path'); await mkdir(noPath);
  const callixOptions = { ...options, timeout: 120000, env: { ...env, CALLIX_BIN: '', PATH: noPath } };
  const authorProject=join(temp,'author-project');await mkdir(authorProject);
  await writeFile(join(authorProject,'agent-compositor.json'),JSON.stringify({enabledPlugins:['plugin-author'],permissions:{rules:[{tool:'plugin_dev',decision:'allow'},{tool:'release_addon',decision:'allow'}]}}));
  const authorOptions={...callixOptions,cwd:authorProject};
  assert.match((await exec(binary,['-p','AUTHOR_DISTRIBUTION_CHECK'],authorOptions)).stdout,/AUTHOR_DISTRIBUTION_OK/);
  const authored=join(authorProject,'.agent-compositor/plugins/release-addon');
  // The package is portable, but its sample server needs an explicit runtime
  // when the fixture intentionally removes all commands from PATH.
  const authoredMcp=JSON.parse(await readFile(join(authored,'.mcp.json'),'utf8'));
  authoredMcp.mcpServers.local.command=process.execPath;
  await writeFile(join(authored,'.mcp.json'),JSON.stringify(authoredMcp));
  await writeFile(join(authored,'tools.ts'),`import {CATALOG_VERSION} from '@agent-compositor/events';\nexport default [{name:'release_addon',description:'Packaged SDK probe',parameters:{type:'object',properties:{}},describe:()=>({tool:'release_addon'}),execute:async()=>({ok:true,data:{marker:'AUTHORED_SDK_OK',catalogVersion:CATALOG_VERSION}})}];`);
  await writeFile(join(authorProject,'agent-compositor.json'),JSON.stringify({enabledPlugins:['plugin-author','release-addon','mcp'],serviceProviders:{'service.agent.instructions':'release-addon'},permissions:{rules:[{tool:'release_addon',decision:'allow'},{tool:'mcp_call',decision:'allow'}]}}));
  assert.match((await exec(binary,['-p','AUTHOR_TOOL_CHECK'],authorOptions)).stdout,/AUTHOR_TOOL_OK/);
  assert.match((await exec(binary,['-p','AUTHOR_COMPOSITE_CHECK'],authorOptions)).stdout,/AUTHOR_COMPOSITE_OK/);
  const command=await exec(binary,['-p','/release-addon','--output-format','stream-json'],authorOptions);
  assert.match(command.stdout,/release-addon ready/);
  const extraProject=join(home,'external projects');await mkdir(extraProject);
  await writeFile(join(extraProject,'evidence.txt'),'INSTALLED_MULTI_PROJECT_EVIDENCE');
  const firstWorkspace=JSON.parse((await exec(binary,['--add-dir','~/external projects','-p','MULTIPROJECT_READ','--output-format','json'],callixOptions)).stdout);
  assert.equal(firstWorkspace.response,'MULTIPROJECT_READ_OK');assert.equal(firstWorkspace.error,undefined);
  const resumedWorkspace=JSON.parse((await exec(binary,['--resume',firstWorkspace.sessionId,'-p','MULTIPROJECT_READ_AGAIN','--output-format','json'],callixOptions)).stdout);
  assert.equal(resumedWorkspace.response,'MULTIPROJECT_READ_OK');assert.equal(resumedWorkspace.error,undefined);
  // A selected external kernel extension works without source packages, a
  // fallback model request, coding tools, Node or Bun on PATH.
  const kernelProject=join(temp,'custom-kernel'),kernelPlugin=join(kernelProject,'plugins/kernel-fixture');
  await mkdir(kernelPlugin,{recursive:true});
  await writeFile(join(kernelProject,'agent-compositor.json'),JSON.stringify({
    enabledPlugins:['kernel-fixture'],sessionProvider:'kernel-fixture',serviceProviders:{'service.agent.run':'kernel-fixture'},
    agent:{builtinTools:[],controlTools:[],tools:['inspect'],skills:false,projectContext:false,fileReferences:false},
    permissions:{rules:[{tool:'inspect',decision:'allow'}]},
  }));
  await writeFile(join(kernelPlugin,'plugin.json'),JSON.stringify({name:'kernel-fixture',version:'1.0.0',trust:'trusted',main:'hooks.js',provides:['service.agent.run']}));
  await writeFile(join(kernelPlugin,'repository.js'),await readFile(new URL('../visual/controller-plugin/hooks.js',import.meta.url),'utf8'));
  await writeFile(join(kernelPlugin,'hooks.js'),`export {sessionRepository} from './repository.js';
  export const events=[{
    name:'plugin.kernel-fixture:inspect',since:'1.0.0',version:1,summary:'Inspect fixture',frozen:true,
    input:{parse(value){if(typeof value.id!=='string')throw Error('id required');return value;}},
    responses:[{kind:'value',summary:'Fixture result',schema:{safeParse(value){return{success:typeof value?.value==='string'};}}}]
  }];
  export const hooks={
    'plugin.kernel-fixture:inspect':event=>({value:'observed '+event.id}),
    'service.agent.run':async event=>{const ctx=event.context;
      if(ctx.tools().map(t=>t.name).join(',')!=='inspect')throw Error('Unexpected capabilities');
      const count=ctx.messages().filter(m=>m.role==='user').length;
      await ctx.execute([{id:'inspect',name:'inspect',args:{id:'resource'}}]);
      const text='KERNEL_'+count+': '+ctx.messages().at(-1).content;
      await ctx.publish(text);return{value:{text}};
    }
  };`);
  await writeFile(join(kernelPlugin,'tools.js'),`export default [{name:'inspect',description:'Fixture inspection',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']},
    describe:()=>({tool:'inspect'}),execute:async(ctx,args)=>({ok:true,data:await ctx.request('plugin.kernel-fixture:inspect',args)})}];`);
  const beforeKernel=modelRequests,kernelOptions={...callixOptions,cwd:kernelProject};
  const firstKernel=JSON.parse((await exec(binary,['-p','Inspect','--output-format','json'],kernelOptions)).stdout);
  assert.equal(firstKernel.response,'KERNEL_1: "observed resource"');assert.equal(firstKernel.error,undefined);
  const resumedKernel=JSON.parse((await exec(binary,['--resume',firstKernel.sessionId,'-p','Inspect again','--output-format','json'],kernelOptions)).stdout);
  assert.equal(resumedKernel.response,'KERNEL_2: "observed resource"');assert.equal(resumedKernel.error,undefined);
  assert.equal(modelRequests,beforeKernel,'Selected kernel extension must not call the fallback model');
  assert.equal((await exec(join(callixDirectory, 'callix'), ['--version'], callixOptions)).stdout.trim(), `callix ${provenance.version}`);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'callix-release-check', private: true, type: 'module' }));
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }));
  await writeFile(join(project, 'leaf.ts'), 'export function leaf(value: number): number { return value + 1; }\n');
  await writeFile(join(project, 'main.ts'), 'import { leaf } from "./leaf.js";\nexport function start(): number { return leaf(1); }\n');
  assert.match((await exec(binary, ['-p', 'CALLIX_DISTRIBUTION_CHECK'], callixOptions)).stdout, /CALLIX_TOOL_RETURNED/);
  assert.equal(callixResult?.provider, 'callix', JSON.stringify(callixResult));
  assert.ok(callixResult?.relations?.some(r => r.kind === 'calls'), JSON.stringify(callixResult));
  assert.ok(callixResult?.nodes?.some(n => n.name === 'start'), JSON.stringify(callixResult));
  assert.ok(callixResult?.symbols?.some(n => n.name === 'leaf'), JSON.stringify(callixResult));
  await writeFile(join(project,'agent-compositor.json'),JSON.stringify({enabledPlugins:['monty','workflows','callix','checkpoint-history','agent-harness','session-manager'],permissions:{rules:[{tool:'edit',path:join(project,'leaf.ts'),decision:'allow'}]}}));
  assert.match((await exec(binary,['-p','CALLIX_SYMBOL_EDIT_CHECK'],callixOptions)).stdout,/CALLIX_SYMBOL_EDIT_OK/);
  assert.equal(guardedEditResult?.match,'exact',JSON.stringify(guardedEditResult));assert.match(guardedEditResult?.hashAfter??'',/^[a-f0-9]{64}$/);assert.match(await readFile(join(project,'leaf.ts'),'utf8'),/value \+ 2/);
  const verify = join(temp, 'verify.mjs');
  await writeFile(verify, `import hooks from ${JSON.stringify(pathToFileURL(join(directory, 'plugins/monty/hooks.js')).href)};
const result = await hooks['service.sandbox.run']({language:'python',code:'6 * 7'}, {signal:new AbortController().signal});
if (result.value?.output !== 42) throw new Error(JSON.stringify(result));
console.log('MONTY_OK');
`);
  assert.match((await exec(process.execPath, [verify], options)).stdout, /MONTY_OK/);
  assert.equal((await readdir(join(directory, 'plugins/mascot/assets'))).filter(name => name.endsWith('.png') || name.endsWith('.apng')).length, 10);
  const marker = join(env.AGENT_HOME, 'preserve-me');
  await writeFile(marker, 'user state');
  await exec('sh', [installer, '--prefix', prefix], options);
  assert.equal(await readFile(marker, 'utf8'), 'user state');
  console.log(`Release smoke passed: ${asset}, checksum rejection, versioned/latest install, inactive packages/offline default market, independent scoped plugin version over bundled cache, bundled authoring skill/composite scaffold/SDK tool/selected instructions/command/skill/MCP with explicit runtime and no PATH, external kernel extension/events/exact tools/custom session repository/resume without fallback model or PATH, packaged GIF decoder/license, model response, background workflow, --add-dir/home paths/resumed scope without PATH, bundled Callix cross-file analysis and guarded symbol editing without PATH, state preservation`);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
