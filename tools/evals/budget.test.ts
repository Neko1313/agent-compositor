import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EvalBudget} from './budget.js';
let root:string,file:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'eval-budget-'));file=join(root,'ledger.json');});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('persists reservations across process instances and refuses requests before overspending',async()=>{
 const first=new EvalBudget(file,'test','gpt-6.1-sol',.15);await first.reserve(10,100);
 const second=new EvalBudget(file,'test','gpt-6.1-sol',.15);
 await expect(second.reserve(10,100)).rejects.toThrow('budget exhausted');
 expect((await second.status()).pendingRequests).toBe(1);expect((await stat(file)).mode&0o777).toBe(0o600);
});
it('serializes independent contenders so only the affordable request is admitted',async()=>{
 const results=await Promise.allSettled([new EvalBudget(file,'test','gpt-6.1-sol',.15).reserve(10,100),new EvalBudget(file,'test','gpt-6.1-sol',.15).reserve(10,100)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('settles reported usage once, while unknown failed requests retain their reservation',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1),id=await budget.reserve(100,200);
 await budget.reported(id,50,10);await budget.reserve(100,200);
 const state=await budget.status();expect(state.reportedRequests).toBe(1);expect(state.pendingRequests).toBe(1);
 await expect(budget.reported(id,0,0)).rejects.toThrow('already settled');
 expect((await budget.status()).committedUpperBoundUsd).toBe(state.committedUpperBoundUsd);
});
it('fails closed on corrupted ledgers and changes to the authorized total',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1);await budget.reserve(1,1);
 await expect(new EvalBudget(file,'test','gpt-6.1-sol',2).reserve(1,1)).rejects.toThrow('mismatch');
 await writeFile(file,'{"version":1,"charges":{"bad":{"microUsd":-100}}}');
 await expect(budget.reserve(1,1)).rejects.toThrow('corruption');
});
it('does not refund reservations using invalid or excessive provider usage',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1),id=await budget.reserve(1,1),before=await budget.status();
 await expect(budget.reported(id,NaN,0)).rejects.toThrow('Invalid');
 await expect(budget.reported(id,1e6,1e6)).rejects.toThrow('exceeds');
 expect(await budget.status()).toEqual(before);
});
it('rejects unbounded requests without creating a charge',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1);
 await expect(budget.reserve(200001,1)).rejects.toThrow('bounded');await expect(budget.reserve(1,8193)).rejects.toThrow('bounded');
 expect((await budget.status()).committedUpperBoundUsd).toBe(0);
});
it('records a separate cache-aware Standard estimate without refunding the conservative bound',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',50),id=await budget.reserve(10000,1000);
 await budget.reported(id,10000,1000,{cachedInputTokens:8000,cacheWriteInputTokens:1000});
 const state=await budget.status();expect(state.committedUpperBoundUsd).toBe(.36);
 expect(state.standardPriceEstimate).toMatchObject({usd:.0153,coveredRequests:1,unavailableRequests:0});
 const second=await budget.reserve(100,200);await budget.reported(second,50,10);
 expect((await budget.status()).standardPriceEstimate.unavailableRequests).toBe(1);
});
it('retains reservations when cache details overlap or are invalid',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1),id=await budget.reserve(100,200),before=await budget.status();
 for(const cache of [{cachedInputTokens:60,cacheWriteInputTokens:50},{cachedInputTokens:-1},{cacheWriteInputTokens:NaN}])await expect(budget.reported(id,100,1,cache)).rejects.toThrow('Invalid cache');
 expect(await budget.status()).toEqual(before);
});
