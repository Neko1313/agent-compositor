import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {diskManifestSchema} from '../../packages/loader/src/manifest.ts';
import {resolve as eventDefinition,uiTextViewSchema} from '../../packages/events/src/index.ts';
import {seedOpenTuiConversationCopiesFixture,conversationCopiesModelResponse} from './opentui-conversation-copies-fixture.mjs';

/** Normal disk plugins, public hooks and saved provider transport; no UI/Core injection. */
export async function seedOpenTuiRenderFixture(cwd,paths,composition='native'){
  const shared=await seedOpenTuiConversationCopiesFixture(cwd,paths,composition);
  const caller=join(cwd,'plugins',shared.requester),source=await readFile(join(caller,'hooks.js'),'utf8');
  await writeFile(join(caller,'hooks-base.js'),source);
  await writeFile(join(caller,'hooks.js'),`import hooks from './hooks-base.js';\nexport default {...hooks,'ui.press':(event,$)=>{if(event.site==='plugin-${shared.requester}-controls')return hooks['ui.press'](event,$);}};\n`);
  const owner='render-proof',painter='render-proof-painter',observer='render-proof-observer',wrapper='render-proof-wrapper',tail='render-proof-tail',slow='render-proof-timeout';
  const directory=join(cwd,'.agent-compositor/render-proof'),gateDirectory=join(directory,'gates');await mkdir(gateDirectory,{recursive:true});
  const trace=join(directory,'trace.jsonl'),publicTrace=join(directory,'public.jsonl'),config=join(directory,'config.json');
  await writeFile(trace,'');await writeFile(publicTrace,'');await writeFile(config,JSON.stringify({mode:'plain',version:0}));
  if(composition==='selected'){
    const editor=join(cwd,'plugins',shared.provider);await writeFile(join(editor,'hooks-base.js'),await readFile(join(editor,'hooks.js'),'utf8'));
    // Observe the chosen controller's original private snapshot. Its factory,
    // native view, lease and real handle behavior remain unchanged.
    await writeFile(join(editor,'hooks.js'),String.raw`
import * as base from './hooks-base.js';import {appendFileSync,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const trace=TRACE,shared=SHARED;
function observe(controller){
  const created=readFileSync(shared,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).findLast(row=>row.event==='editor-created'),lease=created.id;
  const handle=controller.handle,snapshot=controller.snapshot;
  function record(){const state=Reflect.apply(snapshot,controller,[]);appendFileSync(trace,JSON.stringify({at:Date.now(),event:'editor-checkpoint',lease,
    sha256:createHash('sha256').update(state.text).digest('hex'),length:state.text.length,cursor:state.cursor})+'\n');}
  record();controller.handle=function(...args){const value=Reflect.apply(handle,this,args);
    if(value&&typeof value.then==='function')return value.then(result=>{record();return result;});
    record();return value;
  };return controller;
}
export const controllers={...base.controllers,editor:function(...args){const value=Reflect.apply(base.controllers.editor,this,args);
  return value&&typeof value.then==='function'?value.then(observe):observe(value);}};
export default base.default??{};
`.replace('TRACE',JSON.stringify(trace)).replace('SHARED',JSON.stringify(shared.trace)));
  }
  const privatePath='RENDER_PRIVATE_UI_PATH_47.txt',privateOutput='RENDER_PRIVATE_UI_OUTPUT_47';
  await writeFile(join(cwd,privatePath),privateOutput);await writeFile(join(cwd,'render-public.txt'),'RENDER_PUBLIC_TOOL_CONTENT_47\n');
  const common=String.raw`
import {appendFileSync,readFileSync,writeFileSync,existsSync,watch} from 'node:fs';import {join} from 'node:path';
const trace=TRACE,config=CONFIG,gateDirectory=GATES,publicFile=PUBLIC;
const record=value=>appendFileSync(trace,JSON.stringify({at:Date.now(),...value})+'\n');
const settings=()=>JSON.parse(readFileSync(config,'utf8'));
const isPublic=event=>event.site==='plugin:render-proof/public';
const marker=(event,mode,version)=>'RENDER_'+mode.toUpperCase()+' v'+version+' '+event.site+' '+event.viewport.columns+'x'+event.viewport.rows;
function gate(name){return new Promise((resolve,reject)=>{let settled=false;const file=join(gateDirectory,name);
  const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
  const check=()=>{if(existsSync(file))finish();},watcher=watch(gateDirectory,check),deadline=setTimeout(()=>finish(Error('Render gate deadline')),60000);check();
});}
`.replace('TRACE',JSON.stringify(trace)).replace('CONFIG',JSON.stringify(config)).replace('GATES',JSON.stringify(gateDirectory)).replace('PUBLIC',JSON.stringify(publicTrace));
  const publish=String.raw`
let query='';
async function show($,lifecycle){const state=settings();record({event:lifecycle,sessionId:$.session.id});
  await $.ui.view('controls','Render controls',{lines:[{text:'RENDER_CONTROLS',bold:true},
    ...['plain','active','hold','invalid','throw','timeout','guard','chain','invalidate','update','private-tool','disable-render','enable-render'].map(action=>({text:'Render '+action,action}))]},{workspace:2,focus:false});
  await $.ui.view('public','Render public',{input:{id:'producer-query',label:'Producer query',value:query,placeholder:'Producer search'},
    tabs:[{id:'original',label:'Producer tab',action:'producer-action',selected:true}],
    table:{columns:[{label:'Producer column'}],rows:[{id:'original',cells:['Producer cell']}]},
    raster:{width:1,height:1,rgba:'/wAA/w==',alt:'PRODUCER_RASTER_ALT'},
    lines:[{text:'DEFAULT_PUBLIC v'+state.version},{text:'Producer action',action:'producer-action'}]},{workspace:2,focus:false});}
async function command(action,$,site){
  if(action==='private-tool'){const value=await $.agent.tool('read',{path:PRIVATE_PATH});record({event:'private-tool-result',hasExpected:JSON.stringify(value).includes(PRIVATE_OUTPUT)});return;}
  if(action==='disable-render'||action==='enable-render'){const control=action==='disable-render'?'disable':'enable';
    const result=await $.emit('service.extension.control',{action:control,name:'render-proof-painter',scope:'project'});record({event:'extension-result',action:control,result});return;}
  if(['override-action','override-detail','override-tab','main-action','tools-action','help-action','producer-action'].includes(action)){
    record({event:'action',action,site,sessionId:$.session.id});return;}
  if(!['plain','active','hold','invalid','throw','timeout','guard','chain','invalidate','update'].includes(action))throw Error('Unknown render fixture command: '+action);
  const previous=settings(),next={mode:action==='invalidate'||action==='update'?previous.mode:action,version:previous.version+1};writeFileSync(config,JSON.stringify(next));
  if(action==='update')await show($,'producer-updated');
  await $.emit('ui.invalidate',{site:'plugin:render-proof/public',regions:[{row:0,col:0,rows:1,cols:1}]});record({event:'configured',...next,action});
}
export default{'session.start':(_, $)=>show($,'started'),'session.reload':(_, $)=>show($,'reloaded'),
  'command.invoke':(event,$)=>command(event.args.trim(),$),
  'ui.press':(event,$)=>{if(event.site==='plugin-render-proof-controls'||event.site==='plugin-render-proof-public'||event.site==='session'||event.site==='tools'||/^window-\d+$/.test(event.site))return command(event.key,$,event.site);},
  'ui.change':async(event,$)=>{if(event.site!=='plugin-render-proof-public')return;query=event.value;record({event:'producer-change',id:event.id,value:query});await show($,'producer-input');},
  'ui.render':async(event,$)=>{
    const state=settings();if(!event.viewport||event.site==='status'||!['conversation','tools','help','plugin:render-proof/public'].includes(event.site)||state.mode==='plain')return;
    const id=crypto.randomUUID();record({event:'render-start',id,...state,input:event});
    if(isPublic(event)&&state.mode==='hold'){const name='hold-'+state.version+'-'+id;record({event:'held',id,gate:name,sessionId:$.session.id,version:state.version,viewport:event.viewport});
      await gate(name);record({event:'released',id,version:state.version});return{tree:{lines:[{text:'LATE_RENDER v'+state.version}]}};}
    if(isPublic(event)&&state.mode==='invalid')return{tree:{lines:[{text:123}]}};
    if(isPublic(event)&&state.mode==='throw')throw Error('Intentional render fallback proof');
    if(isPublic(event)&&state.mode==='guard'){
      await Promise.resolve();const blocked={};for(const[name,effect]of Object.entries({state:()=>$.state.set('render-illegal',true),notify:()=>$.ui.notify('RENDER_EFFECT_MUST_NOT_APPEAR'),
        tool:()=>$.agent.tool('read',{path:PRIVATE_PATH}),write:()=>$.fs.write('.agent-compositor/render-illegal','MUST_NOT_WRITE')})){
        try{await effect();blocked[name]=false;}catch{blocked[name]=true;}}
      record({event:'guarded',version:state.version,blocked});
    }
    const lines=[{text:marker(event,state.mode,state.version),bold:true}];
    if(event.site==='conversation')lines.push({text:'Main public action',action:'main-action'});
    if(event.site==='tools')lines.push({text:'Tools public action',action:'tools-action'});
    if(event.site==='help')lines.push({text:'Help public action',action:'help-action'});
    if(!isPublic(event))return{tree:{lines}};
    lines.push({text:'Override action',action:'override-action'},{text:'RENDER_LITERAL_\x1b[31m'},...Array.from({length:45},(_,index)=>({text:'RENDER_SCROLL_'+String(index).padStart(2,'0')})));
    return{tree:{input:{id:'must-not-replace-producer',value:'OVERRIDE_INPUT_MUST_NOT_APPEAR'},
      tabs:[{id:'public',label:'Public tab',action:'override-tab',selected:true},{id:'blocked',label:'Disabled tab',action:'disabled-tab',disabled:true}],
      raster:{width:1,height:1,rgba:'/wAA/w==',alt:'RENDER_RASTER_ALT_47 \x1b[31m'},
      table:{columns:[{label:'Name'},{label:'State'}],rows:[{id:'proof',cells:['Public row','Ready'],action:'override-action',expanded:true,details:[{text:'Override detail',action:'override-detail'}]}]},lines}};
  }};
`.replaceAll('PRIVATE_PATH',JSON.stringify(privatePath)).replaceAll('PRIVATE_OUTPUT',JSON.stringify(privateOutput));
  // The painter can unload while the original publisher/default stays alive.
  // This proves provider revocation without inventing a window-tree exception.
  const renderStart=publish.indexOf("  'ui.render':async");
  const producerSource=publish.slice(0,renderStart).replace(/,\s*$/,'\n')+'};\n';
  const painterSource='export default{\n'+publish.slice(renderStart);
  const modules={
    [owner]:{manifest:{commands:[{name:'/render-probe',description:'Isolated public render proof',execution:'immediate'}],hookTimeouts:{'ui.press':300000,'command.invoke':300000}},source:common+producerSource},
    [painter]:{manifest:{hookTimeouts:{'ui.render':60000}},source:common+painterSource},
    [observer]:{manifest:{tier:'prepend',priority:100},source:common+String.raw`
async function lifecycle(event,$){record({event:'observed-reload',plugins:event.plugins.map(plugin=>plugin.name)});
  await $.ui.view('lifecycle','Render lifecycle',{lines:[{text:'RENDER_LIFECYCLE'},{text:'Enable render provider',action:'enable'}]},{workspace:2,focus:false});}
export default{'session.start':(event,$)=>lifecycle(event,$),'session.reload':(event,$)=>lifecycle(event,$),
  'service.ui.configure':input=>{record({event:'appearance-published',input});},
  'ui.press':async(event,$)=>{if(event.site!=='plugin-render-proof-observer-lifecycle'||event.key!=='enable')return;
    const result=await $.emit('service.extension.control',{action:'enable',name:'render-proof-painter',scope:'project'});record({event:'observer-enable',result});},
  'ui.render':event=>{appendFileSync(publicFile,JSON.stringify({at:Date.now(),event:'ui.render',input:event})+'\n');}};`},
    [wrapper]:{manifest:{tier:'prepend',priority:50},source:common+String.raw`export default{'ui.render':async(event,$)=>{if(!isPublic(event)||settings().mode!=='chain')return;record({event:'chain-before'});const result=await $.next();record({event:'chain-after'});return result;}};`},
    [slow]:{manifest:{tier:'prepend',priority:25,hookTimeouts:{'ui.render':100}},source:common+String.raw`export default{'ui.render':async event=>{if(!isPublic(event)||settings().mode!=='timeout')return;record({event:'timeout-started'});await new Promise(done=>setTimeout(done,600));record({event:'timeout-late'});return{tree:{lines:[{text:'TIMEOUT_LATE_MUST_NOT_APPEAR'}]}};}};`},
    [tail]:{manifest:{tier:'append'},source:common+String.raw`export default{'ui.render':event=>{if(!isPublic(event))return;const state=settings();record({event:'tail',...state});if(state.mode==='throw')return{tree:{lines:[{text:'TAIL_THROW v'+state.version}]}};}};`},
  };
  for(const[name,module]of Object.entries(modules)){
    const path=join(cwd,'plugins',name);await mkdir(path,{recursive:true});const manifest={name,version:'1.0.0',trust:'trusted',main:'hooks.js',...module.manifest};
    diskManifestSchema.parse(manifest);await writeFile(join(path,'plugin.json'),JSON.stringify(manifest));await writeFile(join(path,'hooks.js'),module.source);
  }
  const plugins=[shared.provider,shared.requester,shared.observer,...(shared.selectedProvider?[shared.selectedProvider]:[]),...Object.keys(modules),'ui-theme','extension-manager'];
  for(const name of plugins.filter(name=>!['ui-theme','extension-manager'].includes(name))){
    const path=join(cwd,'plugins',name);diskManifestSchema.parse(JSON.parse(await readFile(join(path,'plugin.json'),'utf8')));
    const module=await import(pathToFileURL(join(path,'hooks.js')).href);
    for(const hook of Object.keys(module.default??{}))if(!eventDefinition(hook))throw Error('Unknown render fixture hook: '+name+'/'+hook);
  }
  uiTextViewSchema.parse({lines:[{text:'RENDER fixture valid',action:'override-action'}],raster:{width:1,height:1,rgba:'/wAA/w==',alt:'RENDER_RASTER_ALT_47'}});
  return{composition,plugins,selected:shared.selected,rules:shared.rules,shared,owner,painter,observer,trace,publicTrace,config,gateDirectory,privatePath,privateOutput,
    themeFile:join(paths.state,'theme.json'),ids:{controls:'plugin-'+owner+'-controls',public:'plugin-'+owner+'-public',lifecycle:'plugin-'+observer+'-lifecycle'}};
}

export function renderModelResponse(prompt,body){
  let delta;
  if(prompt==='APP_RENDER_PUBLIC')delta=body.messages.some(message=>message.role==='tool'&&message.tool_call_id==='render-public-read')?{content:'RENDER_PUBLIC_DONE'}:
    {tool_calls:[{index:0,id:'render-public-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'render-public.txt'})}}]};
  else if(prompt==='APP_RENDER_RESTORED')delta={content:'RENDER_RESTORED: '+(body.messages.some(message=>message.role==='assistant'&&message.content==='RENDER_PUBLIC_DONE')&&body.messages.some(message=>message.role==='tool'&&message.tool_call_id==='copy-question'&&message.content?.includes('Production'))?'retained':'missing')};
  else return conversationCopiesModelResponse(prompt,body);
  return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}
