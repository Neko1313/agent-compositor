import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Runtime} from '@agent-compositor/runtime';
import {attach,type HooksHost} from '@agent-compositor/hooks';
import {ProjectStorage} from '@agent-compositor/config';
import {PluginLoader} from '@agent-compositor/loader';
import {buildApp,type BuiltApp} from '../../../packages/app/src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
export type Check=()=>Promise<void>;
export class Fixture {
 root='';cwd='';home='';storage!:ProjectStorage;module:any;host!:HooksHost;runtime!:Runtime;
 views:any[]=[];notices:any[]=[];appearances:any[]=[];models:any[]=[];tools:any[]=[];state:any[]=[];
 failWrite=false;denyWrite=false;failView=false;failNotify=false;failModel=false;failAgent=false;
 providers:Record<string,string>={};abort=new AbortController();model:(request:any)=>Promise<any>=async()=> 'contract answer';
 apps:BuiltApp[]=[];compactions=0;clears=0;
 constructor(readonly name:string,readonly directory=resolve('plugins',name)){}
 async init(prepare?:(cwd:string,home:string)=>Promise<void>){
  this.root=await mkdtemp(join(tmpdir(),'ac-behavior-'));this.cwd=join(this.root,'project');this.home=join(this.root,'home');await mkdir(this.cwd);await mkdir(this.home);await mkdir(join(this.cwd,'.agent-compositor'));
  if(prepare)await prepare(this.cwd,this.home);
  this.storage=new ProjectStorage(this.cwd,{HOME:this.home});await this.storage.init();
  this.resetHost();let captured:any;
  const facade={registerPlugin:(...args:any[])=>{captured={manifest:args[0],hooks:args[1]};(this.host.registerPlugin as any)(...args);}} as unknown as HooksHost;
  const report=await new PluginLoader(facade,{dirs:[this.directory]}).loadAll();assert.deepEqual(report.failed,[]);assert.equal(report.loaded.length,1);
  this.module={...report.loaded[0],...captured};return this;
 }
 resetHost(){
  if(this.host&&this.module)this.host.unregisterPlugin(this.name);
  this.abort=new AbortController();this.runtime=new Runtime({providers:this.providers});
  this.host=attach(this.runtime,{session:{id:'behavior',cwd:this.cwd},workspaceRoot:this.cwd,storage:this.storage,signal:()=>this.abort.signal,
   model:{complete:async request=>{this.models.push(request);if(this.failModel)throw Error('model unavailable');return this.model(request);}},
   notify:(message,level,plugin)=>{if(this.failNotify)throw Error('notification unavailable');this.notices.push({message,level,plugin});},
   agent:{clear:async()=>{if(this.failAgent)throw Error('clear unavailable');this.clears++;},compact:async()=>{if(this.failAgent)throw Error('compaction unavailable');this.compactions++;}},
  });
  for(const event of ['service.ui.view','service.ui.surface'])this.runtime.setResolver(event,(input:any)=>{if(this.failView)throw Error('view unavailable');this.views.push(input);return{value:true};});
  this.runtime.setResolver('service.ui.configure',(input:any)=>{if(this.failView)throw Error('appearance unavailable');this.appearances.push(input);return{value:true};});
  this.runtime.setResolver('service.todo.update',(input:any)=>{this.state.push(input);return{value:input};});
  this.runtime.setResolver('service.usage.quota',()=>({value:{available:false}}));
  this.runtime.setResolver('service.fs.write',async(input:any)=>{
   if(this.denyWrite)return{deny:'fixture policy denies this write'};
   if(this.failWrite)throw Error('storage unavailable');
   if(input.path.startsWith('.agent-compositor/'))await this.storage.legacyWrite(input.path,input.content);
   else{const file=resolve(this.cwd,input.path);await mkdir(join(file,'..'),{recursive:true});await writeFile(file,input.content);}
   return{value:true};
  });
  if(this.module)this.host.registerPlugin(this.module.manifest,this.module.hooks,this.module.tier,this.module.events,this.module.controllers);
 }
 async emit(event:string,input:any,allowFault=false){let result;try{result=await this.host.emit(event,{...(event.startsWith('tool.')?{callId:'behavior-call'}:{}),...input});}catch(error){if(!allowFault)throw error;return{value:undefined,faults:[error]};}if(!allowFault)assert.deepEqual(result.faults,[],`${this.name} ${event} faults: ${JSON.stringify(result.faults)}`);return result as any;}
 async prompt(text:string,allowFault=false){
  if(typeof text!=='string')return this.emit('prompt.submit',{text},allowFault);
  const trimmed=text.trim(),name=trimmed.split(/\s+/,1)[0];
  if(this.module?.commands?.some((command:any)=>command.name===name&&command.execution==='immediate'))
   return this.emit('command.invoke',{plugin:this.name,name,text:trimmed,args:trimmed.slice(name.length).trimStart()},allowFault);
  return this.emit('prompt.submit',{text},allowFault);
 }
 async start(){await this.emit('session.start',{sessionId:'behavior',cwd:this.cwd,plugins:[]});}
 text(){return JSON.stringify({views:this.views,notices:this.notices,appearances:this.appearances});}
 file(name:string){return join(this.storage.paths.state,name);}
 async saved(name:string){return readFile(this.file(name),'utf8');}
 async seed(name:string,value:string){await mkdir(join(this.file(name),'..'),{recursive:true});await writeFile(this.file(name),value);}
 async app(config:any={},provider:any=new ScriptedProvider([]),options:any={}){
  await writeFile(join(this.cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false},...config}));
  await writeFile(join(this.storage.paths.state,'extensions-state.json'),JSON.stringify({enabled:[this.name],disabled:[],installed:{}}));
  const app=await buildApp({cwd:this.cwd,env:{HOME:this.home},provider,agentHub:false,pluginDirs:[this.directory],sessionId:'behavior',...options});this.apps.push(app);assert.deepEqual(app.pluginErrors,[]);assert.ok(app.plugins.some(p=>p.manifest.name===this.name));return app;
 }
 async close(){this.abort.abort(Error('Fixture closed'));for(const app of this.apps)await app.close();if(this.module){this.host.unregisterPlugin(this.name);await this.module.dispose?.();}await rm(this.root,{recursive:true,force:true});}
}
export class Casebook {
 checks=new Map<string,Check>();observations:{requirement:string;passed:true}[]=[];
 constructor(readonly fixture:Fixture){}
 add(ids:string|string[],check:Check){for(const id of typeof ids==='string'?[ids]:ids){assert.ok(!this.checks.has(id),'Duplicate oracle '+id);this.checks.set(id,check);}return this;}
 async run(ids?:string[]){
  // A group shares one real oracle; execute each unique assertion body once, record all requirements it proves.
  const selected=ids??[...this.checks.keys()],executed=new Set<Check>();
  for(const id of selected){const check=this.checks.get(id);assert.ok(check,'Missing oracle '+this.fixture.name+' '+id);if(!executed.has(check)){this.fixture.views=[];this.fixture.notices=[];this.fixture.appearances=[];this.fixture.models=[];if(process.env.BEHAVIOR_TRACE)process.stderr.write(this.fixture.name+" "+id+"\n");try{await check();}catch(error){throw new Error(this.fixture.name+' '+id+' failed: '+String(error),{cause:error});}executed.add(check);}this.observations.push({requirement:id,passed:true});}
  return this.observations;
 }
}
