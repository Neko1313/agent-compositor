import {afterEach,expect,it} from 'vitest';
import {AgentCore,ScriptedProvider} from '../src/index.js';
import {todoTool} from '@agent-compositor/tools';
const cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
function core(provider=new ScriptedProvider([])){
 const value=new AgentCore({cwd:process.cwd(),provider,tools:[todoTool]});cores.push(value);return value;
}
it('keeps default task lists private to each core even in the same process/project',async()=>{
 const first=core();await first.invokeTool('todo',{todos:[{content:'First task',status:'pending'}]});
 const second=core();expect(await second.invokeTool('todo',{})).toMatchObject({ok:true,output:{todos:[]}});
 await second.invokeTool('todo',{todos:[{content:'Second task',status:'in_progress'}]});
 expect(await first.invokeTool('todo',{})).toMatchObject({output:{todos:[{content:'First task',status:'pending'}]}});
 await second.close();expect(await first.invokeTool('todo',{})).toMatchObject({output:{todos:[{content:'First task',status:'pending'}]}});
});
it('keeps an ephemeral task child from overwriting its parent task list',async()=>{
 const provider=new ScriptedProvider([{toolCalls:[{name:'todo',args:{todos:[{content:'Child task',status:'in_progress'}]}}]},{text:'Child complete.'}]);
 const parent=core(provider);await parent.invokeTool('todo',{todos:[{content:'Parent task',status:'pending'}]});
 expect(await parent.invokeTool('task',{prompt:'Do the child work'})).toMatchObject({ok:true});
 expect(await parent.invokeTool('todo',{})).toMatchObject({output:{todos:[{content:'Parent task',status:'pending'}]}});
});
