import {it,expect} from 'vitest';
import {AgentCore} from '../src/loop.js';
import {ScriptedProvider} from '../src/provider.js';

it.each([
  [{value:{decision:'allow',risk:'medium',policy:'task-context',reason:'Requested configured CI check'}},1,0],
  [{value:{decision:'allow',risk:'medium',reason:'Legacy medium assessment'}},0,1],
  [{value:{decision:'deny',risk:'high',reason:'Outside the user task'}},0,0],
  [{deny:'Reviewer refused this action'},0,0],
  [{value:{decision:'ask',risk:'unknown',reason:'Missing target'}},0,1],
])('resolves review %j without converting refusal into another human question',async(verdict,executions,questions)=>{
  let executed=0,asked=0;
  const provider=new ScriptedProvider([{toolCalls:[{name:'ci_check',args:{}}]},{text:'Done'}]);
  const core=new AgentCore({cwd:process.cwd(),provider,controlTools:[],tools:[{
    name:'ci_check',description:'Run the configured project CI check',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{executed++;return{ok:true,data:'checked'};},
  }],permissionReview:async()=>verdict,onApproval:async()=>{asked++;return false;}});
  try{
    await core.submit('Run the configured CI check');
    expect(executed).toBe(executions);expect(asked).toBe(questions);
    if((verdict as any).deny||(verdict as any).value?.decision==='deny')
      expect(core.getMessages().find(message=>message.role==='tool')?.content).toMatch(/review/i);
  }finally{await core.close();}
});
it('keeps an explicit host deny binding even for a task-context approval',async()=>{
  let reviews=0,effects=0,questions=0;
  const core=new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([{toolCalls:[{name:'ci_check',args:{}}]},{text:'Denied'}]),
    tools:[{name:'ci_check',description:'Configured check',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{effects++;return{ok:true,data:'effect'};}}],
    rules:[{tool:'ci_check',decision:'deny'}],permissionReview:async()=>{reviews++;return{value:{decision:'allow',risk:'medium',policy:'task-context',reason:'Requested'}};},onApproval:async()=>{questions++;return true;}});
  try{await core.submit('Run configured CI');expect([reviews,effects,questions]).toEqual([0,0,0]);}finally{await core.close();}
});
it('does not apply task-context medium approval without an actual task',async()=>{
  let effects=0,questions=0;
  const core=new AgentCore({cwd:process.cwd(),controlTools:[],tools:[{name:'ci_check',description:'Configured check',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{effects++;return{ok:true,data:'effect'};}}],
    permissionReview:async()=>({value:{decision:'allow',risk:'medium',policy:'task-context',reason:'No task'}}),onApproval:async()=>{questions++;return false;}});
  try{expect((await core.invokeTool('ci_check',{})).ok).toBe(false);expect(effects).toBe(0);expect(questions).toBe(1);}finally{await core.close();}
});
it('does not open a manual approval after the original call was interrupted during review',async()=>{
  let entered=false,finish=()=>{},questions=0,effects=0;
  const core=new AgentCore({cwd:process.cwd(),provider:new ScriptedProvider([{toolCalls:[{name:'ci_check',args:{}}]}]),
    tools:[{name:'ci_check',description:'Check',parameters:{type:'object'},describe:()=>({tool:'ci_check'}),execute:async()=>{effects++;return{ok:true,data:'effect'};}}],
    permissionReview:async()=>{entered=true;await new Promise<void>(done=>{finish=done;});return{value:{decision:'ask',risk:'unknown',reason:'Unavailable'}};},
    onApproval:async()=>{questions++;return false;}});
  try{const main=core.submit('Run CI');await expect.poll(()=>entered).toBe(true);core.interrupt();finish();await main;expect(questions).toBe(0);expect(effects).toBe(0);}
  finally{finish();await core.close();}
});
