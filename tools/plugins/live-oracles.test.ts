import {it,expect} from 'vitest';
import {negativeControls,mathOracle,riskOracle,taskApprovalOracle,workflowOracle,authorOracle,compactionOracle} from './live-tasks.js';
it('separates actual refusals, uncertain reviews and task-scoped approvals',()=>{
 riskOracle({decision:'deny',risk:'high'},false,'deny');
 expect(()=>riskOracle({decision:'ask',risk:'unknown'},false,'deny')).toThrow();
 taskApprovalOracle({decision:'allow',risk:'medium',policy:'task-context',reason:'Requested bounded CI check'});
 for(const result of [{decision:'allow',risk:'medium',reason:'No policy'},{decision:'allow',risk:'high',policy:'task-context',reason:'Unsafe'},{decision:'ask',risk:'medium',policy:'task-context',reason:'Not approved'}])
  expect(()=>taskApprovalOracle(result)).toThrow();
});
it('live graders reject fabricated, unsafe and incomplete results',()=>{
 expect(negativeControls()).toHaveLength(13);
 mathOracle('42');riskOracle({decision:'allow',risk:'low'},true);
 workflowOracle({status:'completed',stages:[{output:'{"answer":42}'}]});
 authorOracle({name:'live-greeting'},[{message:'HELLO_LIVE'}],false);
 compactionOracle([{content:'CORE_SYSTEM_RULE GOAL42 '+ 'details '.repeat(100)}],[{content:'CORE_SYSTEM_RULE GOAL42'}]);
});
