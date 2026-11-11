import {open,mkdir,readFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicJson} from '../../packages/config/src/storage.js';

// Conservative ceiling above the documented standard GPT-6.1 Sol token rates.
// This is an admission/accounting bound, not an invoice or account-wide spending limit.
const INPUT_MICRO_USD=30,OUTPUT_MICRO_USD=60;
export const EVAL_BUDGET_POLICY='sol-2026-11-11-input30-output60';
type Charge={microUsd:number;status:'reserved'|'reported';inputTokens?:number;outputTokens?:number;
 cachedInputTokens?:number;cacheWriteInputTokens?:number;estimatedStandardMicroUsd?:number};
type Ledger={version:1;policy:string;profile:string;model:string;limitMicroUsd:number;charges:Record<string,Charge>};
export class EvalBudget {
 constructor(readonly file:string,readonly profile:string,readonly model:string,readonly maxUsd:number){
  if(!Number.isFinite(maxUsd)||maxUsd<=0||!Number.isSafeInteger(Math.round(maxUsd*1e6)))throw Error('max-usd must be a positive finite USD limit');
 }
 private async read():Promise<Ledger>{
  let data:Ledger;
  try{data=JSON.parse(await readFile(this.file,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return{version:1,policy:EVAL_BUDGET_POLICY,profile:this.profile,model:this.model,limitMicroUsd:Math.round(this.maxUsd*1e6),charges:{}};}
  if(data.version!==1||data.policy!==EVAL_BUDGET_POLICY||data.profile!==this.profile||data.model!==this.model||data.limitMicroUsd!==Math.round(this.maxUsd*1e6)||!data.charges||
    Object.values(data.charges).some(c=>!Number.isSafeInteger(c.microUsd)||c.microUsd<0||!['reserved','reported'].includes(c.status)||
      (c.estimatedStandardMicroUsd!==undefined&&(!Number.isSafeInteger(c.estimatedStandardMicroUsd)||c.estimatedStandardMicroUsd<0))))throw Error('Budget ledger mismatch or corruption; refusing paid requests');
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
 async reserve(requestBytes:number,maxOutputTokens:number):Promise<string>{
  if(!Number.isSafeInteger(requestBytes)||requestBytes<0||requestBytes>200000||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192)throw Error('Request exceeds the bounded evaluation profile');
  // UTF-8 bytes conservatively bound tokenized request content; allow template overhead.
  const microUsd=(requestBytes+4096)*INPUT_MICRO_USD+maxOutputTokens*OUTPUT_MICRO_USD;
  return this.change(data=>{
   const used=Object.values(data.charges).reduce((n,c)=>n+c.microUsd,0);
   if(used+microUsd>data.limitMicroUsd)throw Error('Evaluation USD budget exhausted before request admission');
   const id=randomUUID();data.charges[id]={microUsd,status:'reserved'};return id;
  });
 }
 async reported(id:string,inputTokens:number,outputTokens:number,cache?:{cachedInputTokens?:number;cacheWriteInputTokens?:number}):Promise<void>{
  if(![inputTokens,outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid provider usage; reservation retained');
  const cached=cache?.cachedInputTokens??0,written=cache?.cacheWriteInputTokens??0;
  if(![cached,written].every(n=>Number.isSafeInteger(n)&&n>=0)||cached+written>inputTokens)throw Error('Invalid cache usage; reservation retained');
  await this.change(data=>{
   const charge=data.charges[id];if(!charge)throw Error('Missing budget reservation');
   if(charge.status==='reported')throw Error('Usage already settled');
   const microUsd=inputTokens*INPUT_MICRO_USD+outputTokens*OUTPUT_MICRO_USD;
   if(microUsd>charge.microUsd)throw Error('Provider usage exceeds its reservation; refusing settlement');
   // Dated Standard/global estimate only; never discounts the admission bound.
   // Rates per million: ordinary $2, cache reads $0.10, writes $2.50, output $10.
   const inputMultiplier=inputTokens>272000?2:1,outputMultiplier=inputTokens>272000?1.5:1;
   const estimate=Math.ceil(((inputTokens-cached-written)*20+cached+written*25)*inputMultiplier/10+outputTokens*10*outputMultiplier);
   data.charges[id]={microUsd,status:'reported',inputTokens,outputTokens,...(cache?{cachedInputTokens:cached,cacheWriteInputTokens:written,estimatedStandardMicroUsd:estimate}:{})};
  });
 }
 async status(){
  const data=await this.read(),charges=Object.values(data.charges);
  return{limitUsd:data.limitMicroUsd/1e6,committedUpperBoundUsd:charges.reduce((n,c)=>n+c.microUsd,0)/1e6,
   pendingRequests:charges.filter(c=>c.status==='reserved').length,reportedRequests:charges.filter(c=>c.status==='reported').length,
   standardPriceEstimate:{policy:'sol-2026-11-11-standard-global',usd:charges.reduce((n,c)=>n+(c.estimatedStandardMicroUsd??0),0)/1e6,
    coveredRequests:charges.filter(c=>c.estimatedStandardMicroUsd!==undefined).length,
    unavailableRequests:charges.filter(c=>c.status==='reported'&&c.estimatedStandardMicroUsd===undefined).length}};
 }
}
