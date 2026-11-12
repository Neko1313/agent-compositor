export const btwProvider={name:'btw-protocol-proof',async *complete(request:any){
 const prompt=request.messages.filter((message:any)=>message.role==='user').at(-1)?.content;
 if(['MAIN_TASK','SIDE_HOLD'].includes(prompt)){
  yield{type:'text_delta' as const,text:prompt==='MAIN_TASK'?'MAIN_AGENT_WORKING':'SIDE_AGENT_WORKING'};
  await new Promise<void>((done,fail)=>{if(request.signal.aborted)return fail(request.signal.reason);request.signal.addEventListener('abort',()=>fail(request.signal.reason),{once:true});});
 }else yield{type:'text_delta' as const,text:prompt==='SIDE_QUESTION'?'SIDE_ANSWER':prompt==='FOLLOWUP_QUESTION'?'SIDE_FOLLOWUP':prompt==='AFTER_RESTART'?'SIDE_RESUMED':'UNEXPECTED_SIDE_INPUT'};
 yield{type:'finish' as const,reason:'stop' as const};
}};
