const plugin = '.agent-compositor/plugins/hello-local';
export function authorReply(messages:any[]) {
  const last = messages.at(-1);
  const call = (name:string,args:unknown) => ({call:{id:'author-'+messages.length,name,args}});
  const prompt=messages.filter(m=>m.role==='user').at(-1)?.content;
  if(prompt==='Disable composed plugin' || prompt==='Enable composed plugin'){
    const action=prompt.startsWith('Disable')?'disable':'enable';
    if(last?.role!=='tool')return call('extension_control',{action,name:'hello-local',scope:'project'});
    try{if(JSON.parse(last.content).changed==='hello-local')return{text:'COMPOSED_'+action.toUpperCase()+'_OK'};}catch{}
    return{text:'Lifecycle probe failed: '+last.content};
  }
  if(prompt==='Check composed MCP'){
    if(last?.role!=='tool')return call('mcp_call',{action:'call',server:'hello-local-local',tool:'ping'});
    try{if(JSON.parse(last.content).content?.[0]?.text==='hello-local MCP ready')return{text:'COMPOSED_MCP_OK'};}catch{}
    return{text:'MCP probe failed: '+last.content};
  }
  if(prompt==='Check composed skill'){
    if(last?.role!=='tool')return call('skills',{name:'hello-local'});
    try{const data=JSON.parse(last.content);if(data.name==='hello-local'&&data.source==='plugin:hello-local')return{text:'COMPOSED_SKILL_OK'};}catch{}
    return{text:'Skill probe failed: '+last.content};
  }
  if (last?.role !== 'tool') return call('skills',{name:'create-plugin'});
  try {
    const data = JSON.parse(last.content);
    if (data.name === 'create-plugin' && typeof data.body === 'string') return call('plugin_dev',{action:'guide',topic:'composition'});
    if (typeof data.bytes === 'number' && data.path) return call('plugin_dev',{action:'check',path:plugin});
    if (data.topic === 'composition') return call('plugin_dev',{action:'init',name:'hello-local',components:['command','panel','tool','service','skill','mcp']});
    if (data.activated === false) return call('read',{path:plugin+'/hooks.ts'});
    if (typeof data.content==='string' && data.content.includes("notify('hello-local ready')")) return call('write',{path:plugin+'/hooks.ts',content:"import {CATALOG_VERSION} from '@agent-compositor/events';\n"+data.content.replace("notify('hello-local ready')","notify('LOCAL_AUTHOR_OK_'+CATALOG_VERSION)")});
    if (data.valid === true && data.executed === false && data.skills.includes('hello-local') && data.mcpServers.includes('hello-local-local')) return {text:'Plugin files checked. Run /reload, then /hello-local.'};
  } catch { /* Show a visible failure instead of fabricating completion. */ }
  return {text:'Plugin authoring failed: '+last.content};
}
