import type {ChatMessage} from '../../packages/core/src/provider.js';

type HintKind='query-recovery'|'glob-example'|'verification-recovery';
type Candidate={index:number;content:string;kinds:HintKind[]};

/** Keep only host-origin hints in memory; never expose their contents in receipts. */
export function hintCandidates(messages:readonly ChatMessage[]):Candidate[]{
 const candidates:Candidate[]=[];
 messages.forEach((message,index)=>{
  if(message.role!=='user'||message.origin!=='harness')return;
  const kinds:HintKind[]=[];
  if(message.content.startsWith('Query recovery:')){
   kinds.push('query-recovery');
   if(message.content.includes('separate glob call with {"pattern":"**/*"}'))kinds.push('glob-example');
  }
  if(message.content.startsWith('Verification recovery:'))kinds.push('verification-recovery');
  if(kinds.length)candidates.push({index,content:message.content,kinds});
 });
 return candidates;
}

/** Report only fixed labels whose exact host message reached the serialized request. */
export function deliveredHintKinds(candidates:readonly Candidate[],body:unknown):HintKind[]{
 if(!body||typeof body!=='object'||!('messages' in body)||!Array.isArray(body.messages))return[];
 const found=new Set<HintKind>();
 for(const candidate of candidates){
  const wire=body.messages[candidate.index];
  if(wire&&typeof wire==='object'&&wire.role==='user'&&wire.content===candidate.content)
   for(const kind of candidate.kinds)found.add(kind);
 }
 return [...found];
}
