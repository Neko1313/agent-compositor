import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EvalBudget,HISTORICAL_CACHE_POLICY,evaluationLedgerDigest} from './budget.js';
let root:string,file:string;
const proof={endpoint:'https://api.openai.com/v1/responses',sourceRevisions:['a'.repeat(40)],evidenceSha256:'b'.repeat(64)};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'budget-cache-review-'));file=join(root,'ledger.json');});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const ledger=async()=>JSON.parse(await readFile(file,'utf8'));
const audit=async()=>({...proof,ledgerSha256:evaluationLedgerDigest(await ledger())});
async function fixture(limit=5){
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',limit),id=await budget.reserve(10000,1000);
 await budget.reported(id,10000,1000,{cachedInputTokens:8000,cacheWriteInputTokens:1000});return {budget,id};
}
it('records an explicit cache review without changing original charges or the authorization',async()=>{
 const {budget,id}=await fixture();
 const unknown=await budget.reserve(10,10);await budget.reported(unknown,50,10);
 const standard=await budget.reserve(10000,1000,'standard');await budget.reported(standard,10000,1000,{cachedInputTokens:8000});
 const pending=await budget.reserve(10,10,'standard'),before=await ledger();
 await budget.reviewHistoricalCache(await audit());
 const after=await ledger();expect(after.charges).toEqual(before.charges);expect(after.limitMicroUsd).toBe(before.limitMicroUsd);
 expect(after.policy).toBe(before.policy);expect((await stat(file)).mode&0o777).toBe(0o600);
 expect(Object.keys(after.cacheReview.charges)).toEqual([id]);expect(after.cacheReview.charges[id].microUsd).toBe(124800);
 expect(after.cacheReview.charges[unknown]).toBeUndefined();expect(after.cacheReview.charges[standard]).toBeUndefined();expect(after.cacheReview.charges[pending]).toBeUndefined();
 expect(after.cacheReview).toMatchObject({...proof,policy:HISTORICAL_CACHE_POLICY});
 expect(await budget.status()).toMatchObject({limitUsd:5,committedUpperBoundUsd:.16833,recordedUpperBoundUsd:.40353,pendingRequests:1,reportedRequests:3,historicalCacheReview:{coveredRequests:1,refinementUsd:.2352}});
 await expect(budget.reviewHistoricalCache(await audit())).rejects.toThrow('already recorded');expect((await ledger()).cacheReview).toEqual(after.cacheReview);
});
it('admits only one affordable concurrent request after a reviewed restart',async()=>{
 const {budget}=await fixture(1);
 await expect(budget.reserve(140000,8192,'standard')).rejects.toThrow('budget exhausted');
 await budget.reviewHistoricalCache(await audit());
 const contenders=await Promise.allSettled([1,2].map(()=>new EvalBudget(file,'test','gpt-6.1-sol',1).reserve(140000,8192,'standard')));
 expect(contenders.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(await budget.status()).toMatchObject({limitUsd:1,committedUpperBoundUsd:.9272,pendingRequests:1});
 await expect(new EvalBudget(file,'test','gpt-6.1-sol',2).reserve(1,1)).rejects.toThrow('mismatch');
});
it('uses the maximum write/output rates and rounds fractional cached-read microdollars upward',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1),id=await budget.reserve(10,10);
 await budget.reported(id,10,10,{cachedInputTokens:1,cacheWriteInputTokens:9});await budget.reviewHistoricalCache(await audit());
 expect((await ledger()).cacheReview.charges[id].microUsd).toBe(871);
});
it('does not discount later legacy charges or clear a persistent pricing halt',async()=>{
 const {budget}=await fixture();await budget.reviewHistoricalCache(await audit());
 const fresh=await budget.reserve(10000,1000);await budget.reported(fresh,10000,1000,{cachedInputTokens:8000});
 expect(await budget.status()).toMatchObject({committedUpperBoundUsd:.4848,historicalCacheReview:{coveredRequests:1}});
 await budget.halt();await expect(budget.reserve(1,1,'standard')).rejects.toThrow('unconfirmed response pricing');
 expect((await ledger()).halted).toBe('unconfirmed-response-pricing');
});
it('cannot apply a historical review as a way to resolve an existing pricing halt',async()=>{
 const {budget}=await fixture();await budget.halt();const before=await ledger();
 await expect(budget.reviewHistoricalCache(await audit())).rejects.toThrow('cannot resolve');expect(await ledger()).toEqual(before);
});
it.each([
 {endpoint:'https://eu.api.openai.com/v1/responses'},
 {sourceRevisions:[]},
 {sourceRevisions:['main']},
 {sourceRevisions:['a'.repeat(40),'a'.repeat(40)]},
 {evidenceSha256:'missing'},
 {discount:999999},
])('refuses unaudited or incompatible provenance %j',async patch=>{
 const {budget}=await fixture();const before=await ledger();
 await expect(budget.reviewHistoricalCache({...await audit(),...patch})).rejects.toThrow('provenance');expect(await ledger()).toEqual(before);
});
it('refuses a review without eligible saved cache counts',async()=>{
 const budget=new EvalBudget(file,'test','gpt-6.1-sol',1),id=await budget.reserve(10,10);await budget.reported(id,10,10);
 const before=await ledger();await expect(budget.reviewHistoricalCache(await audit())).rejects.toThrow('No eligible');expect(await ledger()).toEqual(before);
});
it('refuses to apply an audit to a ledger changed by another admission',async()=>{
 const {budget}=await fixture(),snapshot=await audit();await budget.reserve(1,1,'standard');const before=await ledger();
 await expect(budget.reviewHistoricalCache(snapshot)).rejects.toThrow('changed since');expect(await ledger()).toEqual(before);
});
it.each(['amount','fingerprint','missing-charge','pending-charge','cache-overlap','fractional-cache','null-cache','long-input','wrong-policy','regional-endpoint','empty-references','missing-evidence'] as const)('fails closed on a corrupted review: %s',async kind=>{
 const {budget,id}=await fixture();await budget.reviewHistoricalCache(await audit());const data=await ledger(),entry=data.cacheReview.charges[id],charge=data.charges[id];
 if(kind==='amount')entry.microUsd=0;
 if(kind==='fingerprint')entry.sha256='0'.repeat(64);
 if(kind==='missing-charge')delete data.charges[id];
 if(kind==='pending-charge')charge.status='reserved';
 if(kind==='cache-overlap')charge.cachedInputTokens=10001;
 if(kind==='fractional-cache')charge.cachedInputTokens=.5;
 if(kind==='null-cache')charge.cachedInputTokens=null;
 if(kind==='long-input')charge.inputTokens=300000;
 if(kind==='wrong-policy')data.cacheReview.policy='free';
 if(kind==='regional-endpoint')data.cacheReview.endpoint='https://us.api.openai.com/v1/responses';
 if(kind==='empty-references')data.cacheReview.sourceRevisions=[];
 if(kind==='missing-evidence')delete data.cacheReview.evidenceSha256;
 await writeFile(file,JSON.stringify(data));
 await expect(new EvalBudget(file,'test','gpt-6.1-sol',5).status()).rejects.toThrow('corruption');
 await expect(budget.reserve(1,1,'standard')).rejects.toThrow('corruption');
});
it('rejects inconsistent reported usage even before a historical review',async()=>{
 const {budget,id}=await fixture(),data=await ledger();data.charges[id].microUsd=1;await writeFile(file,JSON.stringify(data));
 await expect(budget.reviewHistoricalCache(await audit())).rejects.toThrow('corruption');
});
