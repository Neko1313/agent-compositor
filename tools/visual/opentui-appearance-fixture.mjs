import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {diskManifestSchema} from '../../packages/loader/src/manifest.ts';
import {resolve as eventDefinition,uiAppearanceSchema} from '../../packages/events/src/index.ts';
import {seedOpenTuiConversationCopiesFixture,conversationCopiesModelResponse} from './opentui-conversation-copies-fixture.mjs';

export const appearancePalette={text:'#d4e2ec',muted:'#9db1bc',accent:'#edbb78',success:'#91d4b2',warning:'#f0cc7d',danger:'#f2a49e',
  border:'#788b9c',titleBackground:'#303946',selectionBackground:'#455d76',selectionText:'#fbf3df'};
export const appearanceOverlay={colors:{accent:'#d7a3ca'},presentation:{agentLabel:'Guide B'}};

/** Appearance producers use only the public hook API; no layout or journal is seeded. */
export async function seedOpenTuiAppearanceFixture(cwd,paths,composition='native'){
  const shared=await seedOpenTuiConversationCopiesFixture(cwd,paths,composition);
  const callerDirectory=join(cwd,'plugins',shared.requester),callerSource=await readFile(join(callerDirectory,'hooks.js'),'utf8');
  await writeFile(join(callerDirectory,'hooks-base.js'),callerSource);
  await writeFile(join(callerDirectory,'hooks.js'),`import hooks from './hooks-base.js';\nexport default {...hooks,'ui.press':(event,$)=>{if(event.site==='plugin-${shared.requester}-controls')return hooks['ui.press'](event,$);}};\n`);
  const producerA='appearance-proof-a',producerB='appearance-proof-b',observer='appearance-proof-observer';
  const evidence=join(cwd,'.agent-compositor/appearance-proof'),trace=join(evidence,'trace.jsonl'),publicTrace=join(evidence,'public.jsonl'),gateDirectory=join(evidence,'gates');
  const lateGate=join(gateDirectory,'late');await mkdir(gateDirectory,{recursive:true});await writeFile(trace,'');await writeFile(publicTrace,'');
  const full={colors:appearancePalette,chrome:{borderStyle:'round',controls:'focus'},presentation:{userLabel:'Operator A',agentLabel:'Guide A',
    welcome:'APPEARANCE_WELCOME_47',toolDetails:false,hints:true,showTools:false}};
  const publications={all:full,partial:{colors:{accent:'#b2d9f1'}},double:{...full,chrome:{borderStyle:'double',controls:'always'}},
    single:{...full,chrome:{borderStyle:'single',controls:'focus'}},'no-hints':{...full,presentation:{...full.presentation,hints:false}},
    tools:{...full,presentation:{...full.presentation,showTools:true}},'no-tools':{...full,presentation:{...full.presentation,showTools:false}},
    details:{...full,presentation:{...full.presentation,toolDetails:true}},compact:full,null:null};
  for(const value of Object.values(publications))if(value!==null)uiAppearanceSchema.parse(value);uiAppearanceSchema.parse(appearanceOverlay);
  const labels={all:'Apply all appearance A',partial:'Replace A with partial',double:'Apply double always',single:'Apply single focus',
    'no-hints':'Apply hidden hints',tools:'Show canonical Tools','no-tools':'Hide canonical Tools',details:'Show tool details',compact:'Hide tool details',null:'Remove A contribution',invalid:'Try invalid appearance'};
  for(const[plugin,values,title]of [[producerA,publications,'Appearance controls'],[producerB,{overlay:appearanceOverlay,muted:{colors:{muted:'#b6d7bf'}},null:null},'Appearance overlay']]){
    const directory=join(cwd,'plugins',plugin);await mkdir(directory,{recursive:true});
    const manifest={name:plugin,version:'1.0.0',trust:'trusted',main:'hooks.js',
      commands:[{name:plugin===producerA?'/appearance-a':'/appearance-b',description:'Isolated public appearance contribution proof',execution:'immediate'}]};
    diskManifestSchema.parse(manifest);await writeFile(join(directory,'plugin.json'),JSON.stringify(manifest));
    const choices=Object.keys(values).map(key=>({text:plugin===producerA?labels[key]:({overlay:'Apply B overlay',muted:'Replace B with muted',null:'Remove B contribution'})[key],action:key}));
    if(plugin===producerA)choices.push({text:labels.invalid,action:'invalid'},{text:'Begin late publication',action:'begin-late'},
      {text:'Disable bundled theme',action:'disable-theme'},{text:'Enable bundled theme',action:'enable-theme'});
    const palette=plugin===producerA?[
      {text:'APPEARANCE_TEXT',tone:'text'},{text:'APPEARANCE_MUTED',tone:'muted'},{text:'APPEARANCE_ACCENT',tone:'accent'},
      {text:'APPEARANCE_SUCCESS',tone:'success'},{text:'APPEARANCE_WARNING',tone:'warning'},{text:'APPEARANCE_DANGER',tone:'danger'},
      {text:'APPEARANCE_SELECTED',selected:true}]:[];
    await writeFile(join(directory,'hooks.js'),String.raw`
import {appendFileSync,watch} from 'node:fs';import {access} from 'node:fs/promises';
const file=TRACE,owner=OWNER,publications=PUBLICATIONS,choices=CHOICES,palette=PALETTE,lateGate=LATE_GATE,gateDirectory=GATE_DIRECTORY;
const record=value=>appendFileSync(file,JSON.stringify({at:Date.now(),owner,...value})+'\n');
async function start($,event,lifecycle){record({event,sessionId:$.session.id,...(lifecycle?.plugins?{plugins:lifecycle.plugins.map(plugin=>plugin.name)}:{})});await $.ui.view('controls',TITLE,{lines:[{text:HEADER,bold:true},...choices]},{workspace:2,focus:false});
  if(palette.length)await $.ui.view('palette','Appearance palette',{lines:palette},{site:'inspector',size:.3,focus:false});}
async function publish(key,$){
  if(key==='begin-late'){
    const background=$.background(),id=crypto.randomUUID();record({event:'late-started',id});
    void (async()=>{await new Promise((resolve,reject)=>{let settled=false;const finish=error=>{if(settled)return;settled=true;watcher.close();clearTimeout(deadline);error?reject(error):resolve();};
      const check=()=>access(lateGate).then(()=>finish(),()=>{}),watcher=watch(gateDirectory,()=>{void check();}),deadline=setTimeout(()=>finish(Error('Appearance late gate deadline')),60000);void check();
    });let accepted=false;try{await background.ui.configure({colors:{accent:'#ff00ff'}});accepted=true;}catch{}record({event:'late-returned',id,accepted});})().catch(error=>record({event:'late-error',id,message:String(error)}));return;
  }
  if(key==='disable-theme'||key==='enable-theme'){
    const action=key==='disable-theme'?'disable':'enable',result=await $.emit('service.extension.control',{action,name:'ui-theme',scope:'project'});record({event:'extension-result',action,result});return;
  }
  if(key==='invalid'){let accepted=false;try{await $.ui.configure({colors:{accent:'\x1b[31m'}});accepted=true;}catch{}record({event:'invalid',accepted});return;}
  if(!Object.hasOwn(publications,key))throw Error('Unknown appearance proof action');
  await $.ui.configure(publications[key]);record({event:'published',key,appearance:publications[key],sessionId:$.session.id});
}
export default{'session.start':(event,$)=>start($,'started',event),'session.reload':(event,$)=>start($,'reloaded',event),
  'command.invoke':(event,$)=>publish(event.args.trim(),$),'ui.press':(event,$)=>{if(event.site==='plugin-'+owner+'-controls')return publish(event.key,$);}};
`.replace('TRACE',JSON.stringify(trace)).replace('OWNER',JSON.stringify(plugin)).replace('PUBLICATIONS',JSON.stringify(values))
      .replace('CHOICES',JSON.stringify(choices)).replace('PALETTE',JSON.stringify(palette)).replace('LATE_GATE',JSON.stringify(lateGate)).replace('GATE_DIRECTORY',JSON.stringify(gateDirectory))
      .replace('TITLE',JSON.stringify(title)).replace('HEADER',JSON.stringify(plugin===producerA?'APPEARANCE_CONTROLS':'APPEARANCE_OVERLAY')));
  }
  const directory=join(cwd,'plugins',observer);await mkdir(directory,{recursive:true});
  const manifest={name:observer,version:'1.0.0',trust:'trusted',main:'hooks.js'};diskManifestSchema.parse(manifest);await writeFile(join(directory,'plugin.json'),JSON.stringify(manifest));
  await writeFile(join(directory,'hooks.js'),String.raw`
import {appendFileSync} from 'node:fs';const file=FILE;
export default Object.fromEntries(['service.ui.configure','ui.render','ui.press','ui.change'].map(event=>[event,input=>{appendFileSync(file,JSON.stringify({event,input})+'\n');}]));
`.replace('FILE',JSON.stringify(publicTrace)));
  const plugins=[shared.provider,shared.requester,shared.observer,...(shared.selectedProvider?[shared.selectedProvider]:[]),producerA,producerB,observer,'ui-theme','extension-manager'];
  for(const plugin of plugins.filter(name=>!['ui-theme','extension-manager'].includes(name))){
    diskManifestSchema.parse(JSON.parse(await readFile(join(cwd,'plugins',plugin,'plugin.json'),'utf8')));
    const hooks=await import(pathToFileURL(join(cwd,'plugins',plugin,'hooks.js')).href);
    for(const name of Object.keys(hooks.default??{}))if(!eventDefinition(name))throw Error('Unknown fixture hook: '+plugin+'/'+name);
  }
  await writeFile(join(cwd,'appearance-tool.txt'),'APPEARANCE_TOOL_CONTENT_47\n');
  return{composition,plugins,selected:shared.selected,rules:shared.rules,shared,producerA,producerB,observer,trace,publicTrace,
    themeFile:join(paths.state,'theme.json'),lateGate,palette:appearancePalette,overlay:appearanceOverlay,publications,
    ids:{controls:'plugin-'+producerA+'-controls',palette:'plugin-'+producerA+'-palette',overlay:'plugin-'+producerB+'-controls'}};
}

/** The normal saved ProviderRouter sends only these bounded loopback requests. */
export function appearanceModelResponse(prompt,body){
  if(prompt==='APP_APPEARANCE_RESTORED'){
    const retained=body.messages.some(message=>message.role==='assistant'&&message.content==='APPEARANCE_TOOL_DONE')
      &&body.messages.some(message=>message.role==='tool'&&message.tool_call_id==='copy-question'&&message.content?.includes('Production'));
    const delta={content:'APPEARANCE_RESTORED: '+(retained?'retained':'missing')};
    return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }
  if(prompt==='APP_APPEARANCE_TOOL'){
    const result=body.messages.findLast(message=>message.role==='tool'&&message.tool_call_id==='appearance-read');
    const delta=result?{content:'APPEARANCE_TOOL_DONE'}:{tool_calls:[{index:0,id:'appearance-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'appearance-tool.txt'})}}]};
    return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }
  return conversationCopiesModelResponse(prompt,body);
}
