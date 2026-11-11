import {open,mkdir,readFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicJson} from '../../packages/config/src/storage.js';

// Conservative ceiling above the documented standard GPT-6.1 Sol token rates.
// This is an admission/accounting bound, not an invoice or account-wide spending limit.
const INPUT_MICRO_USD=30,OUTPUT_MICRO_USD=60;
export const EVAL_BUDGET_POLICY='sol-2026-11-11-input30-output60';
export const STANDARD_BUDGET_POLICY='sol-standard-2026-11-12';
export const HISTORICAL_CACHE_POLICY='sol-global-all-tiers-cache-2026-11-12';
type Charge={microUsd:number;status:'reserved'|'reported';inputTokens?:number;outputTokens?:number;
 pricingPolicy?:typeof STANDARD_BUDGET_POLICY;
 inputTokenCeiling?:number;outputTokenCeiling?:number;
 cachedInputTokens?:number;cacheWriteInputTokens?:number;estimatedStandardMicroUsd?:number};
type ReviewProvenance={endpoint:string;sourceRevisions:string[];evidenceSha256:string;ledgerSha256:string};
type CacheReview=ReviewProvenance&{policy:typeof HISTORICAL_CACHE_POLICY;reviewedAt:string;charges:Record<string,{sha256:string;microUsd:number}>};
type Ledger={version:1;policy:string;profile:string;model:string;limitMicroUsd:number;halted?:'unconfirmed-response-pricing';charges:Record<string,Charge>;cacheReview?:CacheReview};
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
/** Canonical digest for the operator's audited JSON snapshot and immutable charges. */
export const evaluationLedgerDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,v)=>record(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v)).digest('hex');
const fingerprint=evaluationLedgerDigest;
function provenance(value:unknown):value is ReviewProvenance{
 return record(value)&&value.endpoint==='https://api.openai.com/v1/responses'&&Array.isArray(value.sourceRevisions)&&value.sourceRevisions.length>0&&value.sourceRevisions.length<=100&&
  value.sourceRevisions.every((ref:unknown)=>typeof ref==='string'&&/^[a-f0-9]{40}$/.test(ref))&&new Set(value.sourceRevisions).size===value.sourceRevisions.length&&
  typeof value.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceSha256)&&typeof value.ledgerSha256==='string'&&/^[a-f0-9]{64}$/.test(value.ledgerSha256);
}
function validCharge(c:unknown):c is Charge{
 if(!record(c)||!count(c.microUsd)||!['reserved','reported'].includes(c.status)||
  (c.pricingPolicy!==undefined&&c.pricingPolicy!==STANDARD_BUDGET_POLICY)||
  (c.estimatedStandardMicroUsd!==undefined&&!count(c.estimatedStandardMicroUsd)))return false;
 if(c.pricingPolicy===STANDARD_BUDGET_POLICY&&(!count(c.inputTokenCeiling)||c.inputTokenCeiling<4096||c.inputTokenCeiling>204096||!count(c.outputTokenCeiling)||c.outputTokenCeiling<1||c.outputTokenCeiling>8192))return false;
 if(c.status==='reserved')return c.pricingPolicy!==STANDARD_BUDGET_POLICY||c.microUsd===c.inputTokenCeiling*5+c.outputTokenCeiling*10;
 if(!count(c.inputTokens)||c.inputTokens>272000||!count(c.outputTokens)||c.outputTokens>8192)return false;
 if((c.cachedInputTokens!==undefined&&!count(c.cachedInputTokens))||(c.cacheWriteInputTokens!==undefined&&!count(c.cacheWriteInputTokens)))return false;
 const cached=c.cachedInputTokens??0,written=c.cacheWriteInputTokens??0;
 if(!count(cached)||!count(written)||cached+written>c.inputTokens)return false;
 if(c.pricingPolicy===STANDARD_BUDGET_POLICY&&(c.inputTokens>c.inputTokenCeiling||c.outputTokens>c.outputTokenCeiling))return false;
 return c.microUsd===(c.pricingPolicy===STANDARD_BUDGET_POLICY?Math.ceil((c.inputTokens-cached)*5+cached/10+c.outputTokens*10):c.inputTokens*INPUT_MICRO_USD+c.outputTokens*OUTPUT_MICRO_USD);
}
function legacyCacheCeiling(c:Charge):number{
 if(!validCharge(c)||c.status!=='reported'||c.pricingPolicy!==undefined||c.cachedInputTokens===undefined)throw Error('Historical cache review requires valid reported legacy usage with cache counts');
 // Maximum global tier: every non-read token may be a 12h write ($30/M).
 // Keep output at $60/M; only confirmed reads use the maximum $0.60/M rate.
 const units=BigInt(c.inputTokens!-c.cachedInputTokens)*300n+BigInt(c.cachedInputTokens)*6n+BigInt(c.outputTokens!)*600n;
 return Number((units+9n)/10n);
}
function validateReview(data:Ledger){
 const review=data.cacheReview;if(review===undefined)return;
 if(data.model!=='gpt-6.1-sol'||!provenance(review)||review.policy!==HISTORICAL_CACHE_POLICY||typeof review.reviewedAt!=='string'||!Number.isFinite(Date.parse(review.reviewedAt))||
  Object.keys(review).sort().join(',')!=='charges,endpoint,evidenceSha256,ledgerSha256,policy,reviewedAt,sourceRevisions'||!record(review.charges)||!Object.keys(review.charges).length)throw Error('Invalid historical cache review');
 for(const [id,entry] of Object.entries(review.charges)){
  if(!record(entry)||Object.keys(entry).sort().join(',')!=='microUsd,sha256'||!Object.hasOwn(data.charges,id))throw Error('Invalid historical cache review entry');
  const charge=data.charges[id];
  if(entry.sha256!==fingerprint(charge)||entry.microUsd!==legacyCacheCeiling(charge)||entry.microUsd>charge.microUsd)throw Error('Historical cache review no longer matches its original charge');
 }
}
function bounds(data:Ledger){
 let recorded=0,reviewed=0;
 for(const [id,charge] of Object.entries(data.charges)){
  recorded+=charge.microUsd;
  reviewed+=data.cacheReview&&Object.hasOwn(data.cacheReview.charges,id)?data.cacheReview.charges[id].microUsd:charge.microUsd;
  if(!count(recorded)||!count(reviewed))throw Error('Budget totals exceed their integer bound');
 }
 return{recorded,reviewed};
}
export class EvalBudget {
 constructor(readonly file:string,readonly profile:string,readonly model:string,readonly maxUsd:number){
  if(!Number.isFinite(maxUsd)||maxUsd<=0||!Number.isSafeInteger(Math.round(maxUsd*1e6)))throw Error('max-usd must be a positive finite USD limit');
 }
 private async read():Promise<Ledger>{
  let data:Ledger;
  try{data=JSON.parse(await readFile(this.file,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return{version:1,policy:EVAL_BUDGET_POLICY,profile:this.profile,model:this.model,limitMicroUsd:Math.round(this.maxUsd*1e6),charges:{}};}
  try{
   if(!record(data)||data.version!==1||data.policy!==EVAL_BUDGET_POLICY||data.profile!==this.profile||data.model!==this.model||data.limitMicroUsd!==Math.round(this.maxUsd*1e6)||!record(data.charges)||(data.halted!==undefined&&data.halted!=='unconfirmed-response-pricing')||Object.values(data.charges).some(c=>!validCharge(c)))throw Error('Invalid ledger');
   validateReview(data);bounds(data);
  }catch{throw Error('Budget ledger mismatch or corruption; refusing paid requests');}
  return data;
 }
 private async change<T>(update:(data:Ledger)=>T):Promise<T>{
  await mkdir(dirname(this.file),{recursive:true,mode:0o700});
  const lock=this.file+'.lock',deadline=Date.now()+2000;
  let handle:Awaited<ReturnType<typeof open>>;
  for(;;){try{handle=await open(lock,'wx',0o600);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(Date.now()>=deadline)throw Error('Budget ledger is locked; refusing paid requests');await delay(10);}}
  try{const data=await this.read(),result=update(data);await atomicJson(this.file,data);return result;}
  finally{await handle.close();await unlink(lock);}
 }
 async reserve(requestBytes:number,maxOutputTokens:number,pricing:'legacy'|'standard'='legacy'):Promise<string>{
  if(!['legacy','standard'].includes(pricing))throw Error('Unknown evaluation pricing policy');
  if(!Number.isSafeInteger(requestBytes)||requestBytes<0||requestBytes>200000||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192)throw Error('Request exceeds the bounded evaluation profile');
  // UTF-8 bytes conservatively bound tokenized request content; allow template overhead.
  // Standard's $5/M ceiling includes 12h cache writes, with $10/M output.
  // The serialized envelope stays below the long-input pricing threshold.
  const microUsd=(requestBytes+4096)*(pricing==='standard'?5:INPUT_MICRO_USD)+maxOutputTokens*(pricing==='standard'?10:OUTPUT_MICRO_USD);
  return this.change(data=>{
   if(data.halted)throw Error('Evaluation stopped: unconfirmed response pricing requires review');
   const used=bounds(data).reviewed;
   if(used+microUsd>data.limitMicroUsd)throw Error('Evaluation USD budget exhausted before request admission');
   const id=randomUUID();data.charges[id]={microUsd,status:'reserved',...(pricing==='standard'?{pricingPolicy:STANDARD_BUDGET_POLICY,inputTokenCeiling:requestBytes+4096,outputTokenCeiling:maxOutputTokens}:{})};return id;
  });
 }
 async halt():Promise<void>{await this.change(data=>{data.halted='unconfirmed-response-pricing';});}
 /** Trusted operator action after independently auditing historical endpoint/usage provenance. */
 async reviewHistoricalCache(input:ReviewProvenance):Promise<void>{
  if(!provenance(input)||Object.keys(input).sort().join(',')!=='endpoint,evidenceSha256,ledgerSha256,sourceRevisions'||this.model!=='gpt-6.1-sol')throw Error('Historical cache review requires audited official global Sol provenance');
  await this.change(data=>{
   if(data.cacheReview)throw Error('Historical cache review is already recorded; refusing replacement');
   if(data.halted)throw Error('A historical cache review cannot resolve a pricing halt');
   if(evaluationLedgerDigest(data)!==input.ledgerSha256)throw Error('Budget ledger changed since the independent audit; review the new snapshot first');
   const charges=Object.fromEntries(Object.entries(data.charges).filter(([,c])=>c.status==='reported'&&c.pricingPolicy===undefined&&c.cachedInputTokens!==undefined)
    .map(([id,c])=>[id,{sha256:fingerprint(c),microUsd:legacyCacheCeiling(c)}]));
   if(!Object.keys(charges).length)throw Error('No eligible historical cache usage to review');
   data.cacheReview={...input,sourceRevisions:[...input.sourceRevisions],policy:HISTORICAL_CACHE_POLICY,reviewedAt:new Date().toISOString(),charges};
   validateReview(data);
  });
 }
 async reported(id:string,inputTokens:number,outputTokens:number,cache?:{cachedInputTokens?:number;cacheWriteInputTokens?:number}):Promise<void>{
  if(![inputTokens,outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid provider usage; reservation retained');
  const cached=cache?.cachedInputTokens??0,written=cache?.cacheWriteInputTokens??0;
  if(![cached,written].every(n=>Number.isSafeInteger(n)&&n>=0)||cached+written>inputTokens)throw Error('Invalid cache usage; reservation retained');
  await this.change(data=>{
   const charge=data.charges[id];if(!charge)throw Error('Missing budget reservation');
   if(charge.status==='reported')throw Error('Usage already settled');
   if(charge.pricingPolicy===STANDARD_BUDGET_POLICY&&(inputTokens>charge.inputTokenCeiling!||outputTokens>charge.outputTokenCeiling!))throw Error('Provider usage exceeds its token envelope; reservation retained');
   // Unknown non-read input remains charged at the longest cache-write ceiling.
   const microUsd=charge.pricingPolicy===STANDARD_BUDGET_POLICY
    ?Math.ceil((inputTokens-cached)*5+cached/10+outputTokens*10)
    :inputTokens*INPUT_MICRO_USD+outputTokens*OUTPUT_MICRO_USD;
   if(microUsd>charge.microUsd)throw Error('Provider usage exceeds its reservation; refusing settlement');
   // Dated Standard/global estimate only; never discounts the admission bound.
   // Rates per million: ordinary $2, cache reads $0.10, writes $2.50, output $10.
   const inputMultiplier=inputTokens>272000?2:1,outputMultiplier=inputTokens>272000?1.5:1;
   const estimate=Math.ceil(((inputTokens-cached-written)*20+cached+written*25)*inputMultiplier/10+outputTokens*10*outputMultiplier);
   data.charges[id]={...charge,microUsd,status:'reported',inputTokens,outputTokens,...(cache?{cachedInputTokens:cached,cacheWriteInputTokens:written,estimatedStandardMicroUsd:estimate}:{})};
  });
 }
 async status(){
  const data=await this.read(),charges=Object.values(data.charges),total=bounds(data);
  return{limitUsd:data.limitMicroUsd/1e6,committedUpperBoundUsd:total.reviewed/1e6,recordedUpperBoundUsd:total.recorded/1e6,
   ...(data.cacheReview?{historicalCacheReview:{policy:data.cacheReview.policy,reviewedAt:data.cacheReview.reviewedAt,coveredRequests:Object.keys(data.cacheReview.charges).length,refinementUsd:(total.recorded-total.reviewed)/1e6}}:{}),
   ...(data.halted?{halted:data.halted}:{}),
   pendingRequests:charges.filter(c=>c.status==='reserved').length,reportedRequests:charges.filter(c=>c.status==='reported').length,
   standardPriceEstimate:{policy:'sol-2026-11-11-standard-global',usd:charges.reduce((n,c)=>n+(c.estimatedStandardMicroUsd??0),0)/1e6,
    coveredRequests:charges.filter(c=>c.estimatedStandardMicroUsd!==undefined).length,
    unavailableRequests:charges.filter(c=>c.status==='reported'&&c.estimatedStandardMicroUsd===undefined).length}};
 }
}
