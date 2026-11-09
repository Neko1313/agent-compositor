function validate(config: any) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Proxy configuration must be an object');
  for (const key of ['enabled','models','tools']) if(config[key]!==undefined&&typeof config[key]!=='boolean')throw Error(`proxy.${key} must be boolean`);
  if(config.noProxy!==undefined&&(!Array.isArray(config.noProxy)||config.noProxy.some((s:any)=>typeof s!=='string')))throw Error('proxy.noProxy must be an array of hosts');
  if(config.url){const url=new URL(config.url);if(!['http:','https:'].includes(url.protocol))throw Error('Proxy requires an HTTP(S) endpoint');}
  if(config.enabled&&!config.url)throw Error('Configure a proxy URL before enabling');
  return config;
}
async function apply($:any){
  const config=validate(await $.storage.config('proxy.json'));
  const result:any=await $.emit('service.network.configure',{config});
  if(result?.deny)throw Error(result.deny);
  if(!result||!('value'in result))throw Error('Network proxy configuration was not accepted by the host');
  return result.value;
}
async function show($:any){
  const status=await apply($);
  await $.ui.view('network','Network proxy',{lines:[
    {text:status.enabled?'Proxy enabled':'Proxy disabled',bold:true},
    {text:status.url??'No proxy address configured',tone:'muted'},
    {text:`Models: ${status.models?'proxied':'direct'} · Tools: ${status.tools?'proxied':'direct'}`},
    {text:`Bypass: ${(status.noProxy??['localhost','127.0.0.1','::1']).join(', ')}`},
    {text:'[ Configure proxy ]',action:'configure',tone:'accent'},
    {text:status.enabled?'[ Disable proxy ]':'[ Enable proxy ]',action:status.enabled?'off':'on'},
    // Preserve readable diagnostic fields without publishing authenticated URLs.
    {text:JSON.stringify(status,null,2),tone:'muted'},
  ]},{site:'inspector',focus:true});
}
async function configure($:any){
  let config:any={...(await $.storage.config('proxy.json'))},scope='project',message='HTTP(S) CONNECT proxy. Settings apply to model discovery, requests and network tools. Project settings override global defaults.';
  let endpoint:URL|undefined;try{endpoint=config.url?new URL(config.url):undefined;}catch{}
  let username=endpoint?decodeURIComponent(endpoint.username):'',password=endpoint?decodeURIComponent(endpoint.password):'';
  if(endpoint){endpoint.username='';endpoint.password='';}
  while(true){
    const result=await $.ui.form({title:'Configure network proxy',description:message,fields:[
      {id:'enabled',label:'Use proxy',type:'toggle',value:config.enabled??false},
      {id:'url',label:'Proxy address',type:'url',value:endpoint?.href??'',hint:'For example http://127.0.0.1:7890. SOCKS is not supported.'},
      {id:'username',label:'Proxy username',type:'text',value:username},
      {id:'password',label:'Proxy password',type:'password',hint:password?'A password is configured. Blank keeps it.':'Optional.'},
      {id:'clearPassword',label:'Remove stored proxy password',type:'toggle',value:false},
      {id:'models',label:'Proxy model requests',type:'toggle',value:config.models??true},
      {id:'tools',label:'Proxy network tools',type:'toggle',value:config.tools??true},
      {id:'noProxy',label:'Bypass hosts',type:'text',value:(config.noProxy??['localhost','127.0.0.1','::1']).join(', '),hint:'Comma-separated hosts, .domain suffixes or *.'},
      {id:'scope',label:'Save for',type:'select',value:scope,options:[{value:'project',label:'This project (private user storage)'},{value:'global',label:'All projects'}]},
    ],actions:[{id:'save',label:'Save and apply'},{id:'cancel',label:'Cancel'}]});
    if(!result)return;
    const v=result.values;scope=String(v.scope);username=String(v.username);
    if(v.password)password=String(v.password);if(v.clearPassword)password='';
    try{
      endpoint=String(v.url).trim()?new URL(String(v.url).trim()):undefined;
      if(endpoint){endpoint.username=username;endpoint.password=password;}
      config=validate({enabled:v.enabled===true,...(endpoint?{url:endpoint.href}:{}),models:v.models===true,tools:v.tools===true,noProxy:String(v.noProxy).split(',').map((s:string)=>s.trim()).filter(Boolean)});
      await $.storage.configure('proxy.json',config,scope);
      await show($);await $.ui.notify('Proxy settings saved and applied');return;
    }catch{message='Could not apply proxy settings. Check the HTTP(S) address and enable switch.';}
    if(endpoint){endpoint.username='';endpoint.password='';}
  }
}
async function action(action:string,$:any){
  if(action==='configure'){await configure($);return;}
  if(!['status','on','off'].includes(action))throw Error('/proxy [configure|status|on|off]');
  if(action!=='status'){
    const config=validate({...await $.storage.config('proxy.json'),enabled:action==='on'});
    if($.storage.configure)await $.storage.configure('proxy.json',config,'project');
    else await $.fs.write('.agent-compositor/proxy.json',JSON.stringify(config,null,2));
  }
  await show($);
}
export default {
  'session.start':async(_:unknown,$:any)=>{await apply($);},
  'session.reload':async(_:unknown,$:any)=>{await apply($);},
  'service.model.stream':async(_:unknown,$:any)=>{try{await apply($);}catch{return{deny:'Invalid proxy configuration; open /proxy configure to fix it'};}},
  'tool.check':async(e:any,$:any)=>{if(!['exec','mcp_call','web_fetch','web_search'].includes(e.tool))return;try{await apply($);}catch{return{decision:'deny',reason:'Invalid proxy configuration; open /proxy configure to fix it'};}},
  'prompt.submit':async(e:{text:string},$:any)=>{
    const[command,mode='configure']=e.text.trim().split(/\s+/);if(command!=='/proxy')return;
    try{await action(mode,$);}catch(error){await $.ui.notify((error as Error).message,'error');}
    return{drop:'proxy: handled'};
  },
  'ui.press':async(e:any,$:any)=>{if(e.site==='plugin-network-proxy-network')try{await action(e.key,$);}catch(error){await $.ui.notify((error as Error).message,'error');}},
};
