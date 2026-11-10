import {it,expect} from 'vitest';
import {negativeControls,mathOracle,riskOracle,workflowOracle,authorOracle,compactionOracle} from './live-tasks.js';
it('live graders reject fabricated, unsafe and incomplete results',()=>{
 expect(negativeControls()).toHaveLength(13);
 mathOracle('42');riskOracle({decision:'allow',risk:'low'},true);
 workflowOracle({status:'completed',stages:[{output:'{"answer":42}'}]});
 authorOracle({name:'live-greeting'},[{message:'HELLO_LIVE'}],false);
 compactionOracle([{content:'CORE_SYSTEM_RULE GOAL42 '+ 'details '.repeat(100)}],[{content:'CORE_SYSTEM_RULE GOAL42'}]);
});
