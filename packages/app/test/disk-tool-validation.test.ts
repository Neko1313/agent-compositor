import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ScriptedProvider} from '@agent-compositor/core';
import {buildApp,type BuiltApp} from '../src/build.js';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(sources:Record<string,string>){
 const cwd=await mkdtemp(join(tmpdir(),'disk-tool-validator-'));roots.push(cwd);
 const dirs=[];for(const [name,source]of Object.entries(sources)){
  const dir=join(cwd,'plugins',name);await mkdir(dir,{recursive:true});dirs.push(dir);
  await writeFile(join(dir,'plugin.json'),JSON.stringify({name,version:'0.1.0',trust:'trusted'}));await writeFile(join(dir,'tools.ts'),source);
 }
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:Object.keys(sources),agent:{projectContext:false,fileReferences:false,skills:false},permissions:{rules:[{tool:'legacy',decision:'allow'}]}}));
 const provider=new ScriptedProvider([]),app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,pluginDirs:dirs});apps.push(app);return{app,provider};
}
it('runs a real disk validator before approval while corrected arguments retain normal permissions',async()=>{
 const f=await fixture({validated:`export default [{name:'validated_action',description:'Validated action',parameters:{type:'object'},validate:args=>typeof args.value==='number'&&args.value>0?undefined:'validated_action.value must be positive',describe:()=>({tool:'validated_action'}),execute:async()=>({ok:true,data:'EXECUTED'})}];`});
 expect(f.app.pluginErrors).toEqual([]);let approvals=0;
 const core=f.app.createCore(async()=>{approvals++;return false;});
 expect(await core.invokeTool('validated_action',{value:0})).toMatchObject({ok:false,error:'validated_action.value must be positive'});expect(approvals).toBe(0);
 expect(await core.invokeTool('validated_action',{value:1})).toMatchObject({ok:false,error:expect.stringContaining('denied')});expect(approvals).toBe(1);
 expect(f.provider.requests).toEqual([]);
});
it('reports malformed validator fields without loading that owner or blocking legacy peers',async()=>{
 const f=await fixture({invalid:`export default [{name:'broken',description:'Broken validator',parameters:{},validate:'not callable',describe:()=>({tool:'broken'}),execute:async()=>({ok:true,data:1})}];`,legacy:`export default [{name:'legacy',description:'Legacy tool',parameters:{},describe:()=>({tool:'legacy'}),execute:async()=>({ok:true,data:'compatible'})}];`});
 expect(f.app.pluginErrors).toEqual([expect.objectContaining({dir:expect.stringContaining('/plugins/invalid'),error:expect.stringContaining('validate must be a function')})]);
 const core=f.app.createCore(async()=>false);expect(core.getToolNames()).not.toContain('broken');
 expect(await core.invokeTool('legacy',{})).toMatchObject({ok:true,output:'compatible'});expect(f.provider.requests).toEqual([]);
});
it.each(['prototype','own-hidden'])('retains %s methods and their private receiver when composing class-based disk tools',async mode=>{
 const implementation=mode==='prototype'?`validate(args){return args.value>=this.#minimum?undefined:'class value must be positive';}describe(){return{tool:this.name};}async execute(){return{ok:true,data:this.#minimum};}`
 :`constructor(){Object.defineProperties(this,{validate:{value:function(args){return args.value>=this.#minimum?undefined:'class value must be positive';}},describe:{value:function(){return{tool:this.name};}},execute:{value:async function(){return{ok:true,data:this.#minimum};}},usage:{get:()=>({when:'Class usage',examples:[]})},loopGuard:{value:'query'}});}`;
 const f=await fixture({validated:`class Validated {
  #minimum=1; get name(){return'validated_action';}get description(){return'Class-based tool';}get parameters(){return{type:'object'};}
  get usage(){return{when:'Class usage',examples:[]};}get loopGuard(){return'query';}
  ${implementation}
 } export default [new Validated()];`});
 expect(f.app.pluginErrors).toEqual([]);let approvals=0;
 const core=f.app.createCore(async()=>{approvals++;return true;});
 expect(await core.invokeTool('validated_action',{value:0})).toMatchObject({ok:false,error:'class value must be positive'});expect(approvals).toBe(0);
 expect(await core.invokeTool('tool_help',{name:'validated_action'})).toMatchObject({ok:true,output:{description:'Class-based tool',usage:{when:'Class usage'}}});
 expect(await core.invokeTool('validated_action',{value:1})).toMatchObject({ok:true,output:1});expect(approvals).toBe(1);
});
