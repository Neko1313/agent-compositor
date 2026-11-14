import {seedReportFixture} from './test-report-fixture.mjs';
import {seedCiFixture} from './ci-fixture.mjs';
import {workspaceReply} from './workspaces-sample.ts';
import {authorReply} from './author-sample.ts';
import {uxTool,uxReply} from './ux-sample.ts';
import {seedHistory,historyReply} from './history-sample.ts';
import {seedOpenTuiNavigationFixture} from './opentui-navigation-fixture.mjs';
import {seedOpenTuiCancellationFixture} from './opentui-cancellation-fixture.mjs';
import {seedOpenTuiRequestsFixture} from './opentui-requests-fixture.mjs';
import {seedOpenTuiControllersFixture} from './opentui-controllers-fixture.mjs';
import {seedOpenTuiEditorFixture,editorModelResponse} from './opentui-editor-fixture.mjs';
import {seedOpenTuiWorkspaceControllersFixture} from './opentui-workspace-controllers-fixture.mjs';
import {seedOpenTuiConversationCopiesFixture,conversationCopiesModelResponse} from './opentui-conversation-copies-fixture.mjs';
import {seedOpenTuiAppearanceFixture,appearanceModelResponse} from './opentui-appearance-fixture.mjs';
import {questionsSample,questionsReply} from './questions-sample.ts';
import {markdownSample} from './markdown-sample.ts';
import {storagePaths} from '../../packages/config/src/storage.ts';
import { mkdtemp, mkdir, writeFile, cp, rm, readdir, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const cwd = await mkdtemp(join(tmpdir(), 'compositor-visual-'));
const workspaceHome=process.env.VISUAL_WORKSPACES?await mkdtemp(join(tmpdir(),'compositor-project-home-')):cwd;
const output = resolve(process.env.VISUAL_OUTPUT ?? join(root, 'dist/visual-proof'));
await mkdir(output, { recursive: true });
if (process.env.VISUAL_OPENTUI === '1')
  await writeFile(join(output, 'fixture-launch.json'), JSON.stringify({cwd}));
await writeFile(join(output, 'terminal.ansi'), '');
await writeFile(join(output, 'input.jsonl'), '');
if(process.env.VISUAL_PERFORMANCE)await writeFile(join(output,'terminal.events.jsonl'),'');
await mkdir(join(cwd, 'plugins'));
for (const name of ['todos', 'slash-commands', 'ui-theme']) await cp(join(root, 'plugins', name), join(cwd, 'plugins', name), { recursive: true });
if(process.env.VISUAL_OPENTUI_APP&&!process.env.VISUAL_EXECUTABLE)await cp(join(root,'plugins/network-proxy'),join(cwd,'plugins/network-proxy'),{recursive:true});
await mkdir(join(cwd, '.agent-compositor'));
if(process.env.VISUAL_GIT_FIXTURE){
  const git=(...args)=>{
    const result=Bun.spawnSync(['git',...args],{cwd,env:{PATH:process.env.PATH,HOME:workspaceHome,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
    if(result.exitCode!==0)throw Error('Git fixture failed: '+result.stderr.toString());
  };
  git('-c','init.defaultBranch=main','init');
  await writeFile(join(cwd,'review.txt'),'Original content\n');git('add','review.txt');
  git('-c','user.name=Visual fixture','-c','user.email=fixture@example.test','commit','-m','Initial fixture');
  await writeFile(join(cwd,'review.txt'),'STAGED_REVIEW_EVIDENCE\n');git('add','review.txt');
  await writeFile(join(cwd,'review.txt'),'WORKING_REVIEW_EVIDENCE\n');
  const directory=join(cwd,'plugins/git-review-delay');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'git-review-delay',version:'1.0.0',trust:'trusted',main:'hooks.js',hookTimeouts:{'service.exec.run':15000}}));
  await writeFile(join(directory,'hooks.js'),`import {access} from 'node:fs/promises';import {join} from 'node:path';
export default {'service.exec.run':async(event,$)=>{
 if(event.plugin!=='git-review'||!await access(join($.session.cwd,'.git-review-slow')).then(()=>true,()=>false))return;
 const code='require("node:fs").writeFileSync('+JSON.stringify(join($.session.cwd,'git-review-worker.pid'))+',String(process.pid));setInterval(()=>{},1000)';
 return $.next({...event,cmd:'node',args:['-e',code]});
}};`);
}
await writeFile(join(cwd, '.agent-compositor/todos.json'), JSON.stringify([
  { content: 'Inspect project', status: 'pending' }, { content: 'Build interactive UI', status: 'pending' },
  { content: 'Verify drag and persistence', status: 'pending' },
]));
if(process.env.VISUAL_MASCOT_GIF){
  await mkdir(join(cwd,'animations'));
  await cp(resolve(process.env.VISUAL_MASCOT_GIF),join(cwd,'animations/source.gif'));
  const names=['idle','thinking','searching','editing','planning','waiting_subagents','question','approval','done','error'];
  await writeFile(join(cwd,'.agent-compositor/mascot.json'),JSON.stringify({pack:'animations',animations:Object.fromEntries(names.map(name=>[name,'source.gif']))}));
}
if(process.env.VISUAL_HISTORY)await seedHistory(cwd);
if(process.env.VISUAL_PERFORMANCE)await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['todos','slash-commands','ui-theme',...(process.env.VISUAL_PERFORMANCE_MOTION?['mascot']:[])],agent:{projectContext:false,skills:false},compaction:{enabled:false}}));
if(process.env.VISUAL_BACKGROUND)await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['background-jobs','todos','slash-commands','session-manager'],agent:{projectContext:false,skills:false},compaction:{enabled:false},permissions:{rules:[{tool:'exec',decision:'allow'}]}}));
if(process.env.VISUAL_AUTHOR){
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},compaction:{enabled:false},permissions:{rules:[{tool:'plugin_dev',decision:'allow'},{tool:'write',decision:'allow'},{tool:'mcp_call',decision:'allow'},{tool:'extension_control',decision:'allow'}]}}));
}
if(process.env.VISUAL_CONTROLLERS){
  await cp(join(root,'tools/visual/controller-plugin'),join(cwd,'plugins/controller-proof'),{recursive:true});
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({
    enabledPlugins:['controller-proof','session-manager'],sessionProvider:'controller-proof',
    ui:{controllers:Object.fromEntries(['editor','approval','question','form','placement','history'].map(kind=>[kind,'controller-proof']))},
    agent:{builtinTools:['exec'],controlTools:[],skills:false,projectContext:false,fileReferences:false},
  }));
}
if(process.env.VISUAL_WORKSPACES){
  await mkdir(join(workspaceHome,'proj-api'));await mkdir(join(workspaceHome,'other project'));
  await writeFile(join(workspaceHome,'proj-api/endpoint.txt'),'PROJECT_API_EVIDENCE');
  await writeFile(join(workspaceHome,'proj-api/AGENTS.md'),'API_PROJECT_RULES');
  await writeFile(join(workspaceHome,'other project/notes.txt'),'OTHER_PROJECT_EVIDENCE');
  await writeFile(join(cwd,'.agent-compositor/callix.json'),'{"background":false}');
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['agent-harness','web','callix','session-manager'],agent:{skills:false,controlTools:[],projectContext:false},permissions:{rules:[{tool:'web_search',decision:'allow'},{tool:'web_fetch',decision:'allow'}]}}));
}
if(!process.env.VISUAL_MARKETPLACE&&!process.env.VISUAL_ONBOARDING){
  // Existing positive scenarios explicitly select their fixture packages.
  const all=(await readdir(join(root,'plugins'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  const configFile=join(cwd,'agent-compositor.json'),config=await readFile(configFile,'utf8').then(JSON.parse).catch(()=>({}));
  if(!config.enabledPlugins)config.enabledPlugins=[...all,'harness-proof','agent-harness','agent-hub','extension-manager','marketplace-manager','model-selector','provider-auth','session-manager',...(process.env.VISUAL_AUTHOR?['hello-local']:[])];
  await writeFile(configFile,JSON.stringify(config));
}else{
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},permissions:{rules:[{tool:'extension_control',decision:'allow'}]}}));
}
if(process.env.VISUAL_CERT_PLUGIN){
 const name=process.env.VISUAL_CERT_PLUGIN;
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},enabledPlugins:[name,...(name==='btw'?['agent-hub']:[]),'extension-manager','marketplace-manager','session-manager',...(process.env.VISUAL_GIT_FIXTURE?['git-review-delay']:[]),...(name==='test-reports'?['test-report-delay']:[])],compaction:{enabled:false},...(['git-review','project-checks','ci-review','test-reports'].includes(name)?{permissions:{rules:[{tool:name==='git-review'?'git_review':name==='ci-review'?'ci_review':name==='test-reports'?'test_report':'project_check',decision:'allow'}]}}:{})}));
 if(name==='test-reports')await seedReportFixture(cwd);
 if(name==='project-checks')await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{
  check:'node -e '+JSON.stringify('console.log("PROJECT_CHECK_OUTPUT")'),
  fail:'node -e '+JSON.stringify('console.error("PROJECT_CHECK_FAILURE");process.exit(7)'),
  slow:'node -e '+JSON.stringify('require("node:fs").writeFileSync("check-worker.pid",String(process.pid));setInterval(()=>{},1000)'),
 }}));
 if(name==='cost')await writeFile(join(cwd,'.agent-compositor/usage-visual-certification.json'),JSON.stringify({in:42,out:7,turns:1}));
 if(name==='workflows')for(const [id,label]of [['a'.repeat(40),'WORKFLOW_ALPHA'],['b'.repeat(40),'WORKFLOW_BETA']]){const dir=join(cwd,'.agent-compositor/workflows',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'journal.json'),JSON.stringify([{prompt:label,result:'Verified journal evidence'}]));}
 if(name==='checkpoint-history'){
  const dir=join(cwd,'.agent-compositor/turn-checkpoints/visual-certification');await mkdir(dir,{recursive:true});await writeFile(join(cwd,'review.txt'),'AFTER');
  const hash=value=>new Bun.CryptoHasher('sha256').update(value).digest('hex');
  const data={id:'visual-proof',at:Date.now(),messages:[{role:'user',content:'Historical fixture'}],before:{'review.txt':{data:Buffer.from('BEFORE').toString('base64'),hash:hash('BEFORE'),mode:420}},after:{'review.txt':hash('AFTER')},afterContent:{'review.txt':Buffer.from('AFTER').toString('base64')}};
  await writeFile(join(dir,'visual-proof.json'),JSON.stringify(data));await writeFile(join(dir,'visual-proof.meta.json'),JSON.stringify(data));
 }
}
const ciBin=process.env.VISUAL_CERT_PLUGIN==='ci-review'?await seedCiFixture(cwd):undefined;
const token = crypto.randomUUID();
let active;
let marketplaceRequests=0;
let onboardingRequests=0;
if(process.env.VISUAL_ONBOARDING){
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false,skills:false,verifyCompletion:false},compaction:{enabled:false}}));
 const paths=storagePaths(cwd,{...process.env,HOME:workspaceHome,AGENT_HOME:join(workspaceHome,'.agent-compositor')});
 await writeFile(join(output,'onboarding-identity.json'),JSON.stringify({cwd:paths.project,home:paths.home,state:paths.state}));
 await writeFile(join(output,'onboarding-transport.json'),JSON.stringify({requests:0}));
}
if(process.env.VISUAL_EXECUTABLE&&process.env.VISUAL_HARNESS){
 if(process.env.VISUAL_PLUGIN_DIR)throw Error('Native workflow proof uses the bundled package; candidate overrides require the source-host scenario');
 const directory=join(cwd,'plugins/harness-proof');await mkdir(directory,{recursive:true});
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'harness-plugin/hooks.ts')],target:'bun',format:'esm'});
 if(!built.success||built.outputs.length!==1)throw Error('Cannot build the native workflow trigger fixture');
 await writeFile(join(directory,'hooks.js'),Buffer.from(await built.outputs[0].arrayBuffer()));
 const manifest=JSON.parse(await readFile(join(import.meta.dir,'harness-plugin/plugin.json'),'utf8'));manifest.main='hooks.js';await writeFile(join(directory,'plugin.json'),JSON.stringify(manifest));
 const paths=storagePaths(cwd,{...process.env,HOME:workspaceHome,AGENT_HOME:join(workspaceHome,'.agent-compositor')});
 await writeFile(join(output,'fixture-launch.json'),JSON.stringify({cwd:paths.project,home:paths.home,state:paths.state,executable:resolve(process.env.VISUAL_EXECUTABLE)}));
}
if(process.env.VISUAL_WINDOW_CONTROLS){
 if(process.env.VISUAL_EXECUTABLE&&process.env.VISUAL_PLUGIN_DIR)throw Error('Native window-controls proof cannot override bundled plugin directories');
 const paths=storagePaths(cwd,{...process.env,HOME:workspaceHome,AGENT_HOME:join(workspaceHome,'.agent-compositor')});
 const executable=process.env.VISUAL_EXECUTABLE?resolve(process.env.VISUAL_EXECUTABLE):undefined;
 await writeFile(join(output,'window-controls-launch.json'),JSON.stringify({
  cwd:paths.project,home:paths.home,state:paths.state,mode:executable?'binary':'source',
  ...(executable?{executable,sha256:new Bun.CryptoHasher('sha256').update(await readFile(executable)).digest('hex')}:{}),
 }));
}
if(process.env.VISUAL_AGENT_HISTORY)await writeFile(join(cwd,'history-proof.txt'),'HISTORICAL_TOOL_EVIDENCE');
const workflowRequests=[];
let appLaunch;
let appStarts=0;
let appRequests=0;
const appBootKey='SYNTHETIC_BOOT_KEY_47',appUiKey='SYNTHETIC_UI_KEY_47';
const appReceipt=value=>appendFileSync(join(output,'app-http.jsonl'),JSON.stringify({at:Date.now(),...value})+'\n');
let terminalSize={cols:100,rows:30};
async function start(ws) {
  if(process.env.VISUAL_PERFORMANCE)appendFileSync(join(output,'terminal.events.jsonl'),JSON.stringify({type:'start',...terminalSize})+'\n');
  let command = process.env.VISUAL_EXECUTABLE
    ? [resolve(process.env.VISUAL_EXECUTABLE), '--cwd', cwd,...(process.env.VISUAL_START_HISTORY?['--resume']:[])]
    : ['bun', join(import.meta.dir, process.env.VISUAL_OPENTUI === '1' ? 'opentui-sample.ts' : 'fixture.ts'), cwd];
  if(process.env.VISUAL_OPENTUI_APP){
    const sessions=appStarts?(await readdir(join(appLaunch.state,'sessions'))).filter(name=>name.endsWith('.jsonl')):[];
    let resumeId=sessions[0]?.slice(0,-6);
    if(appStarts&&process.env.VISUAL_OPENTUI_CONVERSATION_COPIES){
      const current=JSON.parse(await readFile(appLaunch.conversationCopies.active,'utf8'));
      if(typeof current.id!=='string'||!sessions.includes(current.id+'.jsonl'))throw Error('Actual copy fixture startup must identify an existing journal');
      resumeId=current.id;
    }else if(appStarts&&process.env.VISUAL_OPENTUI_WORKSPACE_CONTROLLERS){
      // This receipt is written by the fixture's actual selected history input,
      // and the check proves the CLI resumed it before requesting a restart.
      const selected=JSON.parse(await readFile(appLaunch.workspaceControllers.resume,'utf8'));
      if(typeof selected.id!=='string'||!sessions.includes(selected.id+'.jsonl'))throw Error('Expected the selected actual history session to exist');
      resumeId=selected.id;
    }else if(appStarts&&sessions.length!==1)throw Error('Expected one actual app session to resume');
    command=[...(process.env.VISUAL_EXECUTABLE?[resolve(process.env.VISUAL_EXECUTABLE)]:['bun',join(root,'packages/app/src/bin.ts')]),
      '--renderer',process.env.VISUAL_OPENTUI_CONVERSATION_COPIES&&appStarts===0?'ink':'opentui','--cwd',cwd,...(sessions.length?['--resume',resumeId]:[])];
    appStarts++;
    appLaunch.launches.push({command});
    await writeFile(join(output,'opentui-app-launch.json'),JSON.stringify(appLaunch));
  }
  const childEnv={...process.env,...(ciBin?{PATH:ciBin+':'+process.env.PATH}:{}),...((process.env.VISUAL_HARNESS||process.env.VISUAL_MARKETPLACE_BUSY||process.env.VISUAL_WORKSPACES||process.env.VISUAL_AUTHOR||process.env.VISUAL_CONTROLLERS||process.env.VISUAL_UX||process.env.VISUAL_MARKDOWN||process.env.VISUAL_QUESTIONS||process.env.VISUAL_HISTORY)?{AGENT_BASE_URL:`http://127.0.0.1:${server.port}/model/${token}/v1`,AGENT_MODEL:'visual-fixture',AGENT_GRAPHICS:'off',...(process.env.VISUAL_HARNESS||process.env.VISUAL_WINDOW_CONTROLS?{AGENT_API_KEY:''}:{})}:{}),AGENT_POINTER:process.env.VISUAL_POINTER??'on',HOME:workspaceHome,AGENT_HOME:join(workspaceHome,'.agent-compositor'),XDG_CONFIG_HOME:join(cwd,'xdg'),VISUAL_COLS:String(terminalSize.cols),VISUAL_ROWS:String(terminalSize.rows)};
  if(process.env.VISUAL_OPENTUI_APP)for(const name of ['AGENT_MODEL','AGENT_BASE_URL','AGENT_API_KEY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])delete childEnv[name];
  const proc = Bun.spawn([process.env.PYTHON ?? 'python3', '-u', join(import.meta.dir, 'pty_bridge.py'), ...command],
    {cwd:root,env:childEnv,stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  active = { ws, proc };
  const sendLines = async () => {
    let pending = '';
    for await (const chunk of proc.stdout) {
      pending += new TextDecoder().decode(chunk);
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        const message = JSON.parse(line);
        if (message.type === 'data') appendFileSync(join(output, 'terminal.ansi'), message.data);
        if(process.env.VISUAL_PERFORMANCE&&message.type==='data')appendFileSync(join(output,'terminal.events.jsonl'),JSON.stringify(message)+'\n');
        if (active?.proc === proc) ws.send(line);
      }
    }
  };
  void sendLines().catch(error => ws.send(JSON.stringify({ type: 'error', data: String(error) })));
  void proc.exited.then(code => { if (active?.proc === proc) ws.send(JSON.stringify({ type: 'exit', code })); });
}
async function stop() { if (!active) return; const previous = active; active = undefined; previous.proc.kill(); await previous.proc.exited; }
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 0),
  async fetch(request, server) {
    const url = new URL(request.url);
    if(process.env.VISUAL_OPENTUI_APP&&url.pathname===`/app-model/${token}/v1/models`){
      const authorization=request.headers.get('authorization')??'';
      appReceipt({kind:'models',credential:authorization==='Bearer '+appUiKey?'ui':authorization==='Bearer '+appBootKey?'bootstrap':'unexpected',authorizationHash:new Bun.CryptoHasher('sha256').update(authorization).digest('hex')});
      return Response.json({data:[{id:'app-alpha',context_window:65536},{id:'app-beta',context_window:65536}]});
    }
    if(process.env.VISUAL_OPENTUI_APP&&url.pathname===`/app-model/${token}/v1/chat/completions`&&request.method==='POST'){
      const body=await request.json(),authorization=request.headers.get('authorization')??'';
      const prompt=body.messages?.filter(message=>message.role==='user').at(-1)?.content??'';
      const credential=authorization==='Bearer '+appUiKey?'ui':authorization==='Bearer '+appBootKey?'bootstrap':'unexpected';
      appReceipt({kind:'completion',number:++appRequests,model:body.model,credential,authorizationHash:new Bun.CryptoHasher('sha256').update(authorization).digest('hex'),body});
      if(process.env.VISUAL_OPENTUI_CONVERSATION_COPIES){
        if(appRequests>24||credential==='unexpected')return new Response('Unexpected isolated copy request',{status:400});
        return conversationCopiesModelResponse(prompt,body);
      }
      if(process.env.VISUAL_OPENTUI_APPEARANCE){
        if(appRequests>24||credential==='unexpected')return new Response('Unexpected isolated appearance request',{status:400});
        return appearanceModelResponse(prompt,body);
      }
      if(process.env.VISUAL_OPENTUI_EDITOR&&typeof prompt==='string'&&prompt.startsWith('APP_EDITOR_')){
        if(appRequests>16||credential==='unexpected')return new Response('Unexpected isolated editor request',{status:400});
        return await editorModelResponse(prompt,body,request,appLaunch.editor,appReceipt);
      }
      const allowed=['APP_QUESTION','APP_HOLD','APP_RESTORED',...(process.env.VISUAL_OPENTUI_NAVIGATION?['APP_APPROVAL']:[]),...(process.env.VISUAL_OPENTUI_CONTROLLERS?['APP_MAIN_FORM_PROBE']:[]),
        ...(process.env.VISUAL_OPENTUI_WORKSPACE_CONTROLLERS?['APP_WORKSPACE_RESUMED','APP_WORKSPACE_RESTORED']:[])];
      if(appRequests>12||credential==='unexpected'||!allowed.includes(prompt))return new Response('Unexpected isolated app request',{status:400});
      if(prompt==='APP_HOLD'){
        const data=`data: ${JSON.stringify({choices:[{delta:{content:'APP_MODEL_HELD'},finish_reason:null}]})}\n\n`;
        return new Response(new ReadableStream({start(controller){
          controller.enqueue(new TextEncoder().encode(data));
          request.signal.addEventListener('abort',()=>{appReceipt({kind:'hold-aborted'});try{controller.close();}catch{}},{once:true});
        }}),{headers:{'content-type':'text/event-stream'}});
      }
      const answer=body.messages?.filter(message=>message.role==='tool'&&message.tool_call_id==='app-main-question').at(-1)?.content;
      const approval=body.messages?.filter(message=>message.role==='tool'&&message.tool_call_id==='app-navigation-write').at(-1)?.content;
      const delta=prompt==='APP_APPROVAL'?(approval?{content:'APP_APPROVAL_SETTLED: '+(/denied|cancel|Permission/i.test(approval)?'denied':'unexpected')}
        :{tool_calls:[{index:0,id:'app-navigation-write',type:'function',function:{name:'write',arguments:JSON.stringify({path:'navigation-approval.txt',content:'MUST_REQUIRE_EXPLICIT_APPROVAL\n'})}}]})
        :prompt==='APP_MAIN_FORM_PROBE'?{content:'APP_MAIN_FORM_PROBE_DONE'}
        :prompt.startsWith('APP_WORKSPACE_')?{content:prompt.slice(4)+': '+(body.messages.some(message=>message.role==='user'&&message.content==='WORKSPACE_SEED_CONTEXT_47')?'seed context retained':'missing seed context')}
        :prompt==='APP_RESTORED'?{content:'APP_RESTORED: '+(answer?.includes('Production')?'Production retained':'missing answer')}
        :answer?{content:'APP_ANSWER_RECEIVED: '+(answer.includes('Production')?'Production':'unexpected')+'; model='+body.model}
        :{tool_calls:[{index:0,id:'app-main-question',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'MAIN_QUESTION: choose deployment',options:['Preview','Production'],allowOther:false})}}]};
      const tool=Boolean(delta.tool_calls);
      return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_HARNESS&&url.pathname===`/model/${token}/v1/models`)return Response.json({data:[{id:'visual-fixture',context_window:32768}]});
    if(process.env.VISUAL_HARNESS&&url.pathname===`/model/${token}/v1/chat/completions`){
      const body=await request.json(),prompt=body.messages?.filter(message=>message.role==='user').at(-1)?.content??'';
      const kind=typeof prompt!=='string'?'unknown':process.env.VISUAL_AGENT_TABLES&&prompt==='MAIN_TABLE_TASK'?'main':process.env.VISUAL_AGENT_TABLES&&prompt==='SIDE_TABLE_TASK'?'side':process.env.VISUAL_AGENT_TABLES&&prompt==='SECOND_TABLE_TASK'?'second':process.env.VISUAL_AGENT_HISTORY&&prompt==='HISTORY_TABLE_TASK'?(body.messages.at(-1)?.role==='tool'?'history-result':'history-call'):prompt.startsWith('PROOF_DISCOVER')?'discover':prompt.startsWith('PROOF_WORKER')?'worker':prompt.startsWith('PROOF_VERIFY')?'verify':prompt.startsWith('Automated workflow completion')?'completion':prompt==='Explain the current status'?'foreground':'unknown';
      workflowRequests.push(kind);await writeFile(join(output,'workflow-transport.json'),JSON.stringify({requests:workflowRequests,paidRequests:0}));
      if(kind==='unknown'||workflowRequests.length>12)return new Response('Unexpected workflow fixture request',{status:400});
      if(kind==='history-call'){
        const delta={tool_calls:[{index:0,id:'history-proof-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'history-proof.txt'})}}]};
        return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:'tool_calls'}],usage:{prompt_tokens:11,completion_tokens:7}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      }
      const reply=kind==='history-result'?'HISTORY_INSPECTION_DONE':kind==='discover'?JSON.stringify([{id:'a',title:'Inspect source',prompt:'PROOF_WORKER_A'},{id:'b',title:'Inspect tests',prompt:'PROOF_WORKER_B'}]):kind==='worker'?'Worker evidence verified':kind==='verify'?'Combined verification complete':kind==='completion'?'Workflow completion delivered to main agent':kind==='side'?'SIDE_TABLE_DONE':kind==='second'?'SECOND_TABLE_DONE':'Main session remains responsive';
      const bytes=new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:reply},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7}})}\n\ndata: [DONE]\n\n`);
      if(kind==='main'){
        let cleanup=()=>{};
        const stream=new ReadableStream({start(controller){
          let closed=false;const close=()=>{if(closed)return;closed=true;clearTimeout(timer);clearInterval(heartbeat);request.signal.removeEventListener('abort',close);try{controller.close();}catch{}};
          const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(new TextEncoder().encode(': fixture waiting\n\n'));},2000);
          const timer=setTimeout(()=>{controller.error(Error('Held main fixture deadline'));close();},60000);cleanup=close;
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:'MAIN_TABLE_WORKING'},finish_reason:null}]})}\n\n`));
          request.signal.addEventListener('abort',close,{once:true});if(request.signal.aborted)close();
        },cancel(){cleanup();}});
        return new Response(stream,{headers:{'content-type':'text/event-stream'}});
      }
      if(kind!=='worker')return new Response(bytes,{headers:{'content-type':'text/event-stream'}});
      let cleanup=()=>{};
      const stream=new ReadableStream({start(controller){
        let closed=false,timer;const deadline=Date.now()+60000;
        const close=()=>{if(closed)return;closed=true;clearTimeout(timer);clearInterval(heartbeat);request.signal.removeEventListener('abort',close);try{controller.close();}catch{}};cleanup=close;
        const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(new TextEncoder().encode(': fixture waiting\n\n'));},2000);
        request.signal.addEventListener('abort',close,{once:true});
        const poll=async()=>{if(closed)return;if(request.signal.aborted)return close();const ready=await readFile(join(cwd,'proof-release.txt')).then(()=>true,()=>false);if(closed)return;if(ready){controller.enqueue(bytes);close();}else if(Date.now()>deadline){controller.error(Error('Workflow fixture worker deadline'));close();}else timer=setTimeout(poll,25);};void poll();
      },cancel(){cleanup();}});
      return new Response(stream,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_ONBOARDING&&url.pathname===`/model/${token}/v1/models`)return Response.json({data:[{id:'onboarding-fixture',context_window:32768}]});
    if(process.env.VISUAL_ONBOARDING&&url.pathname===`/model/${token}/v1/chat/completions`){
      const body=await request.json();onboardingRequests++;
      await writeFile(join(output,'onboarding-transport.json'),JSON.stringify({requests:onboardingRequests,model:body.model,credentialReceived:request.headers.get('authorization')==='Bearer PRIVATE_FIRST_RUN_KEY',projectCheckAdvertised:body.tools?.some(tool=>tool.function?.name==='project_check')===true}));
      if(onboardingRequests>3)return new Response('Unexpected model loop',{status:500});
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:'FIRST_TASK_ANSWER: the configured connection is working.'},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }

    if(process.env.VISUAL_MARKETPLACE_BUSY&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      await request.json();const step=marketplaceRequests++;
      const event=delta=>`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\n`;
      if(step===0){
        let cleanup=()=>{};
        const body=new ReadableStream({start(controller){
          let closed=false,timer;
          const close=()=>{if(closed)return;closed=true;clearTimeout(timer);request.signal.removeEventListener('abort',close);try{controller.close();}catch{}};
          cleanup=close;controller.enqueue(new TextEncoder().encode(event({content:'AGENT_BUSY: the model is still working.'})));
          request.signal.addEventListener('abort',close,{once:true});timer=setTimeout(close,120000);if(request.signal.aborted)close();
        },cancel(){cleanup();}});
        return new Response(body,{headers:{'content-type':'text/event-stream'}});
      }
      const delta=step===1?{tool_calls:[{index:0,id:'marketplace-question',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'AGENT_QUESTION: choose when to continue',options:['Continue','Cancel']})}}]}:{content:'AGENT_DONE: question answered.'};
      return new Response(event(delta)+`data: ${JSON.stringify({choices:[{delta:{},finish_reason:step===1?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_WORKSPACES){
      if(url.pathname===`/search/${token}`)return Response.json({results:[{title:'Workspace internet docs',url:`http://127.0.0.1:${server.port}/page/${token}`,content:'Bounded documentation evidence'}]});
      if(url.pathname===`/page/${token}`)return new Response('<title>Workspace docs</title><h1>DOCUMENT_SOURCE_EVIDENCE</h1>',{headers:{'content-type':'text/html'}});
      if(url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
        const body=await request.json(),reply=workspaceReply(body.messages);
        const delta=reply.call?{tool_calls:[{index:0,id:reply.call.id,type:'function',function:{name:reply.call.name,arguments:JSON.stringify(reply.call.args)}}]}:{content:reply.text};
        return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reply.call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      }
    }
    if(process.env.VISUAL_AUTHOR&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      const body=await request.json(),reply=authorReply(body.messages);
      const delta=reply.call?{tool_calls:[{index:0,id:reply.call.id,type:'function',function:{name:reply.call.name,arguments:JSON.stringify(reply.call.args)}}]}:{content:reply.text};
      return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reply.call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_CONTROLLERS&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      await request.json();return new Response(`data: ${JSON.stringify({choices:[{delta:{content:'CUSTOM RESPONSE: storage and input verified'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_UX&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      const body=await request.json();const reply=uxReply(body.messages);
      const delta=reply?{content:reply}:{tool_calls:[{index:0,id:uxTool.id,type:'function',function:{name:uxTool.name,arguments:JSON.stringify(uxTool.args)}}]};
      return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reply?'stop':'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_HISTORY&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      const body=await request.json();return new Response(`data: ${JSON.stringify({choices:[{delta:{content:historyReply(body.messages)},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_QUESTIONS&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      const body=await request.json();
      const result=body.messages.filter(message=>message.role==='tool').at(-1)?.content;
      const reply=process.env.VISUAL_WINDOW_CONTROLS&&typeof result==='string'&&/^(?:error:\s*)?Question cancelled by user(?:\n|$)/.test(result)?'Questionnaire cancelled.':questionsReply(body.messages);
      const delta=reply?{content:reply}:{tool_calls:[{index:0,id:'questionnaire-proof',type:'function',function:{name:'ask_questions',arguments:JSON.stringify(questionsSample)}}]};
      return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reply?'stop':'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if(process.env.VISUAL_MARKDOWN&&url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
      await request.json();
      return new Response(`data: ${JSON.stringify({choices:[{delta:{content:markdownSample},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    }
    if (url.pathname === '/ws') {
      if (url.searchParams.get('token') !== token || request.headers.get('origin') !== `http://127.0.0.1:${server.port}`) return new Response('Forbidden', { status: 403 });
      if (server.upgrade(request)) return;
      return new Response('Upgrade required', { status: 400 });
    }
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    const files = { '/': join(import.meta.dir, 'terminal.html'), '/xterm.js': join(root, 'node_modules/@xterm/xterm/lib/xterm.js'), '/unicode11.js': join(root,'node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js'), '/graphics.js': join(root, 'tools/visual/graphics.js'), '/performance.js': join(root,'tools/visual/performance.js'), '/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css') };
    return files[url.pathname] ? new Response(Bun.file(files[url.pathname])) : new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) { await stop(); await start(ws); },
    async message(ws, data) {
      const message = JSON.parse(String(data));
      if (message.type === 'restart') { await stop(); ws.send(JSON.stringify({ type: 'reset' })); await start(ws); return; }
      if (active?.ws === ws && ['input', 'resize'].includes(message.type)) {
        if(message.type==='resize')terminalSize={cols:Math.max(16,Math.min(240,Number(message.cols)||100)),rows:Math.max(12,Math.min(100,Number(message.rows)||30))};
        if(process.env.VISUAL_PERFORMANCE&&message.type==='resize')appendFileSync(join(output,'terminal.events.jsonl'),JSON.stringify({type:'resize',...terminalSize})+'\n');
        appendFileSync(join(output, 'input.jsonl'), JSON.stringify({ time: Date.now(), ...message }) + '\n');
        active.proc.stdin.write(JSON.stringify(message) + '\n'); active.proc.stdin.flush();
      }
    },
    async close(ws) { if (active?.ws === ws) await stop(); },
  },
});
if(process.env.VISUAL_OPENTUI_APP){
 if(process.env.VISUAL_PLUGIN_DIR)throw Error('Actual app proof does not substitute plugin directories');
 const paths=storagePaths(cwd,{HOME:workspaceHome,AGENT_HOME:join(workspaceHome,'.agent-compositor')});
 const baseUrl=`http://127.0.0.1:${server.port}/app-model/${token}/v1`;
 await mkdir(paths.state,{recursive:true});await mkdir(paths.home,{recursive:true});
 const cancellation=process.env.VISUAL_OPENTUI_CANCELLATION?await seedOpenTuiCancellationFixture(cwd,paths):undefined;
 const requests=process.env.VISUAL_OPENTUI_REQUESTS?await seedOpenTuiRequestsFixture(cwd,paths):undefined;
 const controllers=process.env.VISUAL_OPENTUI_CONTROLLERS?await seedOpenTuiControllersFixture(cwd,paths):undefined;
 const editor=process.env.VISUAL_OPENTUI_EDITOR?await seedOpenTuiEditorFixture(cwd,paths,process.env.VISUAL_OPENTUI_EDITOR_COMPOSITION??'native'):undefined;
 const workspaceControllers=process.env.VISUAL_OPENTUI_WORKSPACE_CONTROLLERS?await seedOpenTuiWorkspaceControllersFixture(cwd,paths):undefined;
 const conversationCopies=process.env.VISUAL_OPENTUI_CONVERSATION_COPIES?await seedOpenTuiConversationCopiesFixture(cwd,paths,process.env.VISUAL_OPENTUI_COPY_COMPOSITION??'native'):undefined;
 const appearance=process.env.VISUAL_OPENTUI_APPEARANCE?await seedOpenTuiAppearanceFixture(cwd,paths,process.env.VISUAL_OPENTUI_APPEARANCE_COMPOSITION??'native'):undefined;
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['network-proxy','todos','slash-commands','model-selector','provider-auth','session-manager',
  ...(process.env.VISUAL_OPENTUI_MANAGERS?['extension-manager','marketplace-manager','local-flow-probe']:[]),
  ...(process.env.VISUAL_OPENTUI_NAVIGATION?['navigation-probe']:[]),...(cancellation?['cancellation-probe']:[]),...(requests?['request-probe']:[]),
  ...(controllers?[controllers.provider,controllers.requester,'extension-manager']:[]),
  ...(editor?[editor.provider,editor.requester,'extension-manager',...(editor.selectedProvider?[editor.selectedProvider]:[])]:[]),
  ...(workspaceControllers?[workspaceControllers.provider,workspaceControllers.requester,workspaceControllers.observer,'extension-manager']:[]),
  ...(conversationCopies?[conversationCopies.provider,conversationCopies.requester,conversationCopies.observer,'extension-manager',...(conversationCopies.selectedProvider?[conversationCopies.selectedProvider]:[])]:[]),
  ...(appearance?appearance.plugins:[])],
  ...((controllers||editor||workspaceControllers||conversationCopies||appearance)?{ui:{controllers:(controllers??editor??workspaceControllers??conversationCopies??appearance).selected}}:{}),
  ...((cancellation||requests||controllers||editor||workspaceControllers||conversationCopies||appearance)?{permissions:{rules:(cancellation??requests??controllers??editor??workspaceControllers??conversationCopies??appearance).rules}}:{}),agent:{projectContext:false,skills:false,verifyCompletion:false},compaction:{enabled:false}}));
 await writeFile(join(paths.state,'providers.json'),JSON.stringify({profiles:{bootstrap:{type:'openai-compat',baseUrl,model:'app-start',contextWindow:65536,timeoutMs:300000}}}));
 await writeFile(join(paths.state,'model.json'),JSON.stringify('bootstrap'));
 await writeFile(join(paths.home,'credentials.json'),JSON.stringify({bootstrap:{accessToken:appBootKey}}),{mode:0o600});
 await writeFile(join(output,'app-http.jsonl'),'');
 const executable=process.env.VISUAL_EXECUTABLE?resolve(process.env.VISUAL_EXECUTABLE):undefined;
 appLaunch={cwd:paths.project,state:paths.state,home:paths.home,baseUrl,launches:[],mode:executable?'binary':'source',
  ...(executable?{executable,sha256:new Bun.CryptoHasher('sha256').update(await readFile(executable)).digest('hex')}:{}),
  providerOverride:false,environmentProviderOverride:false};
 if(process.env.VISUAL_OPENTUI_NAVIGATION)appLaunch.navigation=await seedOpenTuiNavigationFixture(cwd,paths);
 if(cancellation)appLaunch.cancellation=cancellation;
 if(requests)appLaunch.requests=requests;
 if(controllers)appLaunch.controllers=controllers;
 if(editor)appLaunch.editor=editor;
 if(workspaceControllers)appLaunch.workspaceControllers=workspaceControllers;
 if(conversationCopies)appLaunch.conversationCopies=conversationCopies;
 if(appearance)appLaunch.appearance=appearance;
 if(process.env.VISUAL_OPENTUI_MANAGERS){
  const catalogRoot=join(cwd,'local-flow-catalog'),source=join(catalogRoot,'plugins/local-flow-probe');
  await mkdir(join(catalogRoot,'.claude-plugin'),{recursive:true});await mkdir(source,{recursive:true});
  await writeFile(join(source,'plugin.json'),JSON.stringify({name:'local-flow-probe',version:'1.0.0',trust:'trusted',main:'hooks.js',
   description:'Local fixture for explicit manager installation and activation.'}));
  await writeFile(join(source,'hooks.js'),`async function show($){
  await $.storage.set('loaded',{version:'1.0.0',sessionId:$.session.id});
  await $.ui.view('proof','Local flow probe',{lines:[{text:'LOCAL_FLOW_PROBE_LOADED',bold:true}]},{site:'inspector',focus:false});
}
export default {'session.start':async(_,$)=>show($),'session.reload':async(_,$)=>show($)};
`);
  await writeFile(join(catalogRoot,'.claude-plugin/marketplace.json'),JSON.stringify({name:'local-flow',owner:{name:'Local fixture'},plugins:[{
   name:'local-flow-probe',version:'1.0.0',source:'./plugins/local-flow-probe',description:'Offline manager activation proof',compositor:{format:'native'},
  }]}));
  const installedRoot=resolve(cwd,'.agent-compositor/plugins')===resolve(paths.home,'plugins')?join(paths.state,'project-plugins'):join(cwd,'.agent-compositor/plugins');
  appLaunch.managers={catalogRoot,source,manifest:join(installedRoot,'local-flow-probe/plugin.json'),
   receipt:join(paths.state,'plugin-state/local-flow-probe/loaded.json'),extensionState:join(paths.state,'extensions-state.json'),
   placement:join(cwd,'.agent-compositor/agent-compositor.jsonc')};
 }
 await writeFile(join(output,'opentui-app-launch.json'),JSON.stringify(appLaunch));
}
if(process.env.VISUAL_WORKSPACES)await writeFile(join(cwd,'.agent-compositor/web.json'),JSON.stringify({searchUrl:`http://127.0.0.1:${server.port}/search/${token}`}));
let closing = false;
async function shutdown() { if (closing) return; closing = true; await stop(); server.stop(true); await rm(cwd, { recursive: true, force: true });if(workspaceHome!==cwd)await rm(workspaceHome,{recursive:true,force:true});process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
console.log(`VISUAL_URL=http://127.0.0.1:${server.port}/?token=${token}${process.env.VISUAL_GRAPHICS === "kitty" ? "&graphics=kitty" : ""}${process.env.VISUAL_EXECUTABLE ? "&mode=binary" : ""}`);
