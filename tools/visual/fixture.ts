import {uxTool,uxReply} from "./ux-sample.js";
import {historyReply} from "./history-sample.js";
import {questionsSample,questionsReply} from "./questions-sample.js";
import {markdownSample} from "./markdown-sample.js";
import { buildApp } from "../../packages/app/src/build.js";
import { runTui } from "../../packages/app/src/tui.js";
import { ScriptedProvider } from "../../packages/core/src/provider.js";
const proofProvider={name:"harness-proof",async *complete(req:any){
  const prompt=req.messages.filter((m:any)=>m.role==='user').at(-1)?.content??'';
  if(prompt.startsWith('PROOF_DISCOVER'))yield{type:'text_delta' as const,text:JSON.stringify([{id:'a',title:'Inspect source',prompt:'PROOF_WORKER_A'},{id:'b',title:'Inspect tests',prompt:'PROOF_WORKER_B'}])};
  else if(prompt.startsWith('PROOF_WORKER')){const{access}=await import('node:fs/promises');while(true){req.signal.throwIfAborted();if(await access(process.argv[2]+'/proof-release.txt').then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,50));}yield{type:'text_delta' as const,text:'Worker evidence verified'};}
  else yield{type:'text_delta' as const,text:prompt.startsWith('PROOF_VERIFY')?'Combined verification complete':'Main session remains responsive'};
  yield{type:'finish' as const,reason:'stop' as const};
}};
const app = await buildApp({
  pluginDirs: [new URL('../../plugins',import.meta.url).pathname,...(process.env.VISUAL_HARNESS?[new URL('./harness-plugin',import.meta.url).pathname]:[])],
  cwd: process.argv[2], env: { HOME: process.argv[2], XDG_CONFIG_HOME: `${process.argv[2]}/xdg` },
  provider: process.env.VISUAL_CONTROLLERS?new ScriptedProvider([{text:'CUSTOM RESPONSE: storage and input verified'},{text:'CUSTOM CONTINUATION: restored history verified'}]):process.env.VISUAL_UX?{name:'ux-proof',async *complete(req:any){const reply=uxReply(req.messages);if(reply)yield{type:'text_delta' as const,text:reply};else yield{type:'tool_call' as const,...uxTool};yield{type:'finish' as const,reason:reply?'stop' as const:'tool_calls' as const};}}:process.env.VISUAL_HISTORY?{name:'history-proof',async *complete(req:any){yield{type:'text_delta' as const,text:historyReply(req.messages)};yield{type:'finish' as const,reason:'stop' as const};}}:process.env.VISUAL_QUESTIONS ? {name:'questions-proof',async *complete(req:any){const reply=questionsReply(req.messages);if(reply)yield{type:'text_delta' as const,text:reply};else yield{type:'tool_call' as const,id:'questionnaire-proof',name:'ask_questions',args:questionsSample};yield{type:'finish' as const,reason:reply?'stop' as const:'tool_calls' as const};}}:process.env.VISUAL_MARKDOWN ? new ScriptedProvider([{text:markdownSample}]):process.env.VISUAL_HARNESS?proofProvider:new ScriptedProvider([
    { text: "I will update the project task list.", toolCalls: [{ name: "todo", args: { todos: [
      { content: "Inspect project", status: "completed" },
      { content: "Build interactive UI", status: "in_progress" },
      { content: "Verify drag and persistence", status: "pending" },
    ] } }], usage: { inputTokens: 1200, outputTokens: 140 } },
    { text: "## Todos updated\nThe interface is ready for **visual verification**.\n\nOpen `/todos` to see the task list." },
    { toolCalls: [{ name: "task", args: { prompt: "Inspect task status" } }] },
    { toolCalls: [{ name: "ask_user", args: { question: "Choose report detail", options: ["Compact", "Detailed"] } }] },
    { text: "Child inspection completed with the selected detail." },
    { text: "Delegation complete." },
    { toolCalls: [{name:"write",args:{path:"review-demo.txt",content:"A reviewable change\nWritten by the agent\n"}}] },
    { text: "Review change prepared." },
    { text: "Independent agent response" },
  ]),
});
await runTui(app, process.stdin, process.stdout, process.env.VISUAL_START_HISTORY?"/history":undefined);
