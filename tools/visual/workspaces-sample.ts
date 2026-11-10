// Loopback/provider fixture shared by source and compiled PTY scenarios.
export function workspaceReply(messages:any[]){
  const prompt=messages.filter(m=>m.role==='user').at(-1)?.content??'',last=messages.at(-1);
  const toolId=last?.tool_call_id??last?.toolCallId;
  const toolName=last?.name??messages.flatMap(message=>message.tool_calls??message.toolCalls??[]).find(call=>call.id===toolId)?.function?.name;
  if(prompt.startsWith('Find internet proof')){
    if(last?.role==='tool'&&toolName==='web_search'){
      const result=JSON.parse(last.content);return{call:{id:'page-proof',name:'web_fetch',args:{url:result.results[0].url}}};
    }
    if(last?.role==='tool'&&toolName==='web_fetch'){
      const result=JSON.parse(last.content);return{text:result.text.includes('DOCUMENT_SOURCE_EVIDENCE')?'Internet source verified: '+result.url:'Internet source missing'};
    }
    return{call:{id:'search-proof',name:'web_search',args:{query:'workspace documentation proof'}}};
  }
  if(prompt.startsWith('Read attached project')){
    if(last?.role==='tool'&&toolName==='read')return{text:last.content.includes('PROJECT_API_EVIDENCE')?(prompt.includes('restart')?'Restored attached project verified':'Attached project tool read verified'):'Attached project evidence missing'};
    return{call:{id:'project-proof',name:'read',args:{path:'~/proj-api/endpoint.txt'}}};
  }
  if(prompt.includes('<file')&&prompt.includes('OTHER_PROJECT_EVIDENCE'))return{text:'Quoted home file reference verified'};
  if(prompt.includes('Directory @')&&prompt.includes('API_PROJECT_RULES'))return{text:'Directory reference verified'};
  return{text:'Reference evidence missing'};
}
