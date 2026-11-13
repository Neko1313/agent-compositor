import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CompletionRequest,ModelProvider,ProviderEvent} from '@agent-compositor/core';
import {buildApp,type BuiltApp} from '../src/build.js';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it.each([{regex:false,prefix:'x'},{regex:true,prefix:'x'},{regex:false,prefix:'😀'},{regex:true,prefix:'😀'}])('copies a real grep handoff into read and guarded edit: $regex / $prefix',async({regex,prefix})=>{
 const cwd=await mkdtemp(join(tmpdir(),'search-read-edit-'));roots.push(cwd);
 const before=prefix.repeat(60000)+'needle_old_value'+(prefix==='😀'?'中'.repeat(3000):'')+' suffix',file=join(cwd,'dense.txt');await writeFile(file,before);
 await mkdir(join(cwd,'.agent-compositor'));
 await writeFile(join(cwd,'.agent-compositor/callix.json'),JSON.stringify({background:false}));
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['callix'],agent:{projectContext:false,fileReferences:false,skills:false},permissions:{rules:[{tool:'edit',decision:'allow'}]}}));
 const requests:CompletionRequest[]=[],operations:string[]=[];
 const provider:ModelProvider={name:'search-read-fixture',async *complete(request):AsyncIterable<ProviderEvent>{
  requests.push(request);let args:unknown,name:string;
  if(requests.length===1){name='grep';args={pattern:'needle_old_value',path:'dense.txt',regex};}
  else if(requests.length===2){
   const result=JSON.parse(request.messages.filter(m=>m.role==='tool').at(-1)!.content);
   expect(result.metrics.indexUsed).toBe(false);expect(result.matches[0].text).toContain('needle_old_value');
   name='read';args=result.matches[0].readArgs;expect(args).toMatchObject({cursor:expect.any(String)});
  }else if(requests.length===3){
   const text=request.messages.filter(m=>m.role==='tool').at(-1)!.content;
   const metadata=JSON.parse(text.slice('Read metadata (JSON):\n'.length,text.indexOf('\n\nFile content (verbatim):')));
   expect(metadata.edit.range.start).toBeGreaterThan(59000);
   name='edit';args={editRef:metadata.editRef,oldText:'needle_old_value',newText:'needle_new_value'};
  }else{yield{type:'text_delta',text:'Updated the located marker.'};yield{type:'finish',reason:'stop'};return;}
  operations.push(name);yield{type:'tool_call',id:'step-'+requests.length,name,args};yield{type:'finish',reason:'tool_calls'};
 }};
 const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins/callix')],agentHub:false});apps.push(app);
 const core=app.createCore(async()=>true);await core.submit('Find the old marker and update only it.');
 expect(core.failure).toBeUndefined();expect(requests).toHaveLength(4);expect(operations).toEqual(['grep','read','edit']);
 expect(await readFile(file,'utf8')).toBe(before.replace('needle_old_value','needle_new_value'));
});
