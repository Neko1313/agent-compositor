import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
export const backgroundProvider={name:'background-proof',async *complete(req:any){
 const log=(event:string)=>appendFile(join(process.env.VISUAL_OUTPUT!,'provider-requests.jsonl'),JSON.stringify({event,at:Date.now()})+'\n');
 await log('open');
 try{
  const index=req.messages.findLastIndex((m:any)=>m.role==='user'),prompt=req.messages[index]?.content??'',tool=req.messages.slice(index+1).find((m:any)=>m.role==='tool');
  if(prompt==='Begin interrupt proof'){
   if(!req.signal.aborted)await new Promise<void>(resolve=>req.signal.addEventListener('abort',()=>resolve(),{once:true}));return;
  }
  let call:any,text:string|undefined;
  if(prompt==='Start background proof'){
   if(!tool)call={id:'background-proof-start',name:'exec',args:{command:'sleep 6; printf BACKGROUND_FINISHED',background:true,timeoutMs:30000}};
   else text='Background is running';
  }else if(prompt.startsWith('Automated background completion')){
   if(!tool)call={id:'background-proof-output',name:'exec_output',args:{id:prompt.match(/"id":"([^"]+)"/)?.[1]}};
   else text=tool.content.includes('BACKGROUND_FINISHED')?'Background result reviewed: BACKGROUND_FINISHED':'Background result was unavailable';
  }else text='Still talking while the job runs';
  if(call)yield{type:'tool_call' as const,...call};else yield{type:'text_delta' as const,text:text!};
  yield{type:'finish' as const,reason:call?'tool_calls' as const:'stop' as const};
 }finally{await log('closed');}
}};
