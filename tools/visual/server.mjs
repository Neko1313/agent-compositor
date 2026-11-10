import {workspaceReply} from './workspaces-sample.ts';
import {uxTool,uxReply} from './ux-sample.ts';
import {seedHistory,historyReply} from './history-sample.ts';
import {questionsSample,questionsReply} from './questions-sample.ts';
import {markdownSample} from './markdown-sample.ts';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const cwd = await mkdtemp(join(tmpdir(), 'compositor-visual-'));
const workspaceHome=process.env.VISUAL_WORKSPACES?await mkdtemp(join(tmpdir(),'compositor-project-home-')):cwd;
const output = resolve(process.env.VISUAL_OUTPUT ?? join(root, 'dist/visual-proof'));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'terminal.ansi'), '');
await writeFile(join(output, 'input.jsonl'), '');
await mkdir(join(cwd, 'plugins'));
for (const name of ['todos', 'slash-commands', 'ui-theme']) await cp(join(root, 'plugins', name), join(cwd, 'plugins', name), { recursive: true });
await mkdir(join(cwd, '.agent-compositor'));
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
const token = crypto.randomUUID();
let active;
let terminalSize={cols:100,rows:30};
async function start(ws) {
  const command = process.env.VISUAL_EXECUTABLE
    ? [resolve(process.env.VISUAL_EXECUTABLE), '--cwd', cwd,...(process.env.VISUAL_START_HISTORY?['--resume']:[])]
    : ['bun', join(import.meta.dir, 'fixture.ts'), cwd];
  const proc = Bun.spawn([process.env.PYTHON ?? 'python3', '-u', join(import.meta.dir, 'pty_bridge.py'), ...command],
    { cwd: root, env:{...process.env,...((process.env.VISUAL_WORKSPACES||process.env.VISUAL_CONTROLLERS||process.env.VISUAL_UX||process.env.VISUAL_MARKDOWN||process.env.VISUAL_QUESTIONS||process.env.VISUAL_HISTORY)?{AGENT_BASE_URL:`http://127.0.0.1:${server.port}/model/${token}/v1`,AGENT_MODEL:"visual-fixture",AGENT_GRAPHICS:"off"}:{}),AGENT_POINTER:process.env.VISUAL_POINTER??"on",HOME:workspaceHome,AGENT_HOME:join(workspaceHome, ".agent-compositor"),XDG_CONFIG_HOME:join(cwd,"xdg"),VISUAL_COLS:String(terminalSize.cols),VISUAL_ROWS:String(terminalSize.rows)},stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
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
    if(process.env.VISUAL_WORKSPACES){
      if(url.pathname===`/search/${token}`)return Response.json({results:[{title:'Workspace internet docs',url:`http://127.0.0.1:${server.port}/page/${token}`,content:'Bounded documentation evidence'}]});
      if(url.pathname===`/page/${token}`)return new Response('<title>Workspace docs</title><h1>DOCUMENT_SOURCE_EVIDENCE</h1>',{headers:{'content-type':'text/html'}});
      if(url.pathname===`/model/${token}/v1/chat/completions`&&request.method==='POST'){
        const body=await request.json(),reply=workspaceReply(body.messages);
        const delta=reply.call?{tool_calls:[{index:0,id:reply.call.id,type:'function',function:{name:reply.call.name,arguments:JSON.stringify(reply.call.args)}}]}:{content:reply.text};
        return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:reply.call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
      }
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
      const body=await request.json();const reply=questionsReply(body.messages);const delta=reply?{content:reply}:{tool_calls:[{index:0,id:'questionnaire-proof',type:'function',function:{name:'ask_questions',arguments:JSON.stringify(questionsSample)}}]};
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
    const files = { '/': join(import.meta.dir, 'terminal.html'), '/xterm.js': join(root, 'node_modules/@xterm/xterm/lib/xterm.js'), '/graphics.js': join(root, 'tools/visual/graphics.js'), '/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css') };
    return files[url.pathname] ? new Response(Bun.file(files[url.pathname])) : new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) { await stop(); await start(ws); },
    async message(ws, data) {
      const message = JSON.parse(String(data));
      if (message.type === 'restart') { await stop(); ws.send(JSON.stringify({ type: 'reset' })); await start(ws); return; }
      if (active?.ws === ws && ['input', 'resize'].includes(message.type)) {
        if(message.type==='resize')terminalSize={cols:Math.max(16,Math.min(240,Number(message.cols)||100)),rows:Math.max(12,Math.min(100,Number(message.rows)||30))};
        appendFileSync(join(output, 'input.jsonl'), JSON.stringify({ time: Date.now(), ...message }) + '\n');
        active.proc.stdin.write(JSON.stringify(message) + '\n'); active.proc.stdin.flush();
      }
    },
    async close(ws) { if (active?.ws === ws) await stop(); },
  },
});
if(process.env.VISUAL_WORKSPACES)await writeFile(join(cwd,'.agent-compositor/web.json'),JSON.stringify({searchUrl:`http://127.0.0.1:${server.port}/search/${token}`}));
let closing = false;
async function shutdown() { if (closing) return; closing = true; await stop(); server.stop(true); await rm(cwd, { recursive: true, force: true });if(workspaceHome!==cwd)await rm(workspaceHome,{recursive:true,force:true});process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
console.log(`VISUAL_URL=http://127.0.0.1:${server.port}/?token=${token}${process.env.VISUAL_GRAPHICS === "kitty" ? "&graphics=kitty" : ""}${process.env.VISUAL_EXECUTABLE ? "&mode=binary" : ""}`);
