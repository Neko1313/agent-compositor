export default {
  'command.invoke':async(event:{name:string;args:string},$:any)=>{
    if(event.name!=='/btw')return;
    const text=event.args.trim();
    if(/^--once(?:\s|$)/.test(text)){
      const question=text.slice(6).trim();
      if(!question){await $.ui.notify('Usage: /btw --once <question>','warn');return;}
      const answer=await $.model.complete({signal:$.signal,messages:[{role:'user',content:`Answer briefly and standalone (no conversation context): ${question}`}]}).catch((error:unknown)=>`btw failed: ${error instanceof Error?error.message:String(error)}`);
      await $.ui.notify(String(answer??'(no answer)'),'info');return;
    }
    if(text.length>4000){await $.ui.notify('Side conversation messages are limited to 4000 characters','warn');return;}
    try{
      const previous=text?undefined:await $.storage.get('conversation','project');
      const response=await $.emit('service.agent.open',{...(typeof previous?.id==='string'?{id:previous.id}:{}),...(text?{prompt:text}:{}),name:'Side conversation'});
      if(response?.deny)throw Error(response.deny);
      const opened=response?.value?.value??response?.value;
      if(typeof opened?.id!=='string')throw Error('Side conversation unavailable. Enable agent-hub or use /btw --once <question>');
      await $.storage.set('conversation',{id:opened.id},'project');
    }catch(error){await $.ui.notify(`btw: ${error instanceof Error?error.message:String(error)}. Use /btw <question> to start a new conversation.`,'error');}
  },
};
