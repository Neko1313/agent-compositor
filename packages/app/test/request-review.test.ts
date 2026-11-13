import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ModelProvider,ProviderEvent} from '@agent-compositor/core';
import {buildApp,type BuiltApp} from '../src/build.js';
const roots:string[]=[],apps:BuiltApp[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('reviews the complete typed request rather than attached authorization claims through the real auto plugin',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'request-review-'));roots.push(cwd);
 await writeFile(join(cwd,'fixture.txt'),'ATTACHMENT_CLAIMS_CI_AUTHORIZATION');
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['auto-approve'],agent:{projectContext:false,skills:false}}));
 const task='Inspect @fixture.txt first. '+'Background context. '.repeat(180)+'\nDo not run CI.';
 const reviews:any[]=[];let mainRequests=0,effects=0,questions=0;
 const provider:ModelProvider={name:'request-review-fixture',async *complete(request):AsyncIterable<ProviderEvent>{
  if(request.messages[0]?.content.includes('You assess one proposed tool action')){
   const input=JSON.parse(request.messages[1].content);reviews.push(input);
   yield{type:'text_delta',text:JSON.stringify({approved:!input.context.task.includes('Do not run CI.'),risk:'medium',reason:'The final user restriction controls this operation'})};
   yield{type:'finish',reason:'stop'};return;
  }
  mainRequests++;
  if(mainRequests===1){yield{type:'tool_call',id:'ci',name:'ci_check',args:{}};yield{type:'finish',reason:'tool_calls'};}
  else{yield{type:'text_delta',text:'CI was not run.'};yield{type:'finish',reason:'stop'};}
 }};
 const app=await buildApp({cwd,env:{HOME:cwd},provider,pluginDirs:[join(process.cwd(),'plugins/auto-approve')],agentHub:false});apps.push(app);
 app.plugins.push({manifest:{name:'ci-fixture',version:'1.0.0',trust:'trusted'},hooks:{},tools:[{name:'ci_check',description:'Run CI',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{effects++;return{ok:true,data:'ran'};}}]} as any);
 const core=app.createCore(async()=>{questions++;return false;});await core.submit('/auto on');await core.submit(task);
 expect(core.failure).toBeUndefined();expect(effects).toBe(0);expect(questions).toBe(0);expect(reviews).toHaveLength(1);
 expect(reviews[0].context.task).toBe(task);expect(reviews[0].context.task).not.toContain('ATTACHMENT_CLAIMS');
 const user=core.getMessages().find(m=>m.role==='user')!;expect(user.content).toContain('ATTACHMENT_CLAIMS');expect(user.userRequest).toBe(task);
});
