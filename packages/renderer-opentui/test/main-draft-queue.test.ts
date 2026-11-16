import {expect,it} from 'vitest';
import {MainDraftQueue} from '../src/main-draft-queue.js';
import type {ConversationSession,ConversationSnapshot} from '../src/session.js';

function fixture(){
 let state:ConversationSnapshot={messages:[],running:false,draft:{status:'draft',revision:1,text:''}},current=true,errors=0;
 const calls:string[]=[],gates:((value:boolean)=>void)[]=[];
 const source:ConversationSession={id:'session',generation:1,conversationId:'main',label:'Main',isCurrent:()=>current,
  snapshot:()=>state,subscribe:()=>()=>{},draftChange:(text,revision)=>{
   calls.push('edit:'+text+':'+revision);
   return new Promise(resolve=>gates.push(ok=>{if(ok)state={...state,draft:{status:'draft',revision:revision+1,text}};resolve(ok);}));
  },submit:text=>{calls.push('send:'+text);return true;},steer:text=>{calls.push('steer:'+text);return true;}};
 const queue=new MainDraftQueue(()=>source,()=>errors++);
 return{source,queue,calls,gates,get errors(){return errors;},retire(){current=false;},replace(value:ConversationSnapshot){state=value;}};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('coalesces quick edits but preserves an Enter boundary and later typing',async()=>{
 const f=fixture(),first=f.queue.edit('a');const second=f.queue.edit('ab');
 const sent=f.queue.submit('ab','submit'),later=f.queue.edit('ab!');
 expect(f.calls).toEqual(['edit:a:1']);f.gates.shift()!(true);await tick();
 expect(f.calls).toEqual(['edit:a:1','edit:ab:2']);f.gates.shift()!(true);await tick();
 expect(f.calls).toEqual(['edit:a:1','edit:ab:2','send:ab','edit:ab!:3']);
 f.gates.shift()!(true);expect(await Promise.all([first,second,sent,later])).toEqual([true,true,true,true]);
});
it('does not send when saving fails, and permits an explicit retry',async()=>{
 const f=fixture(),first=f.queue.edit('unsaved'),send=f.queue.submit('unsaved','submit');
 f.gates.shift()!(false);await tick();
 // Submission inserts a fresh save boundary and can still succeed if it is saved.
 expect(f.calls).toEqual(['edit:unsaved:1','edit:unsaved:1']);f.gates.shift()!(false);
 expect(await first).toBe(false);expect(await send).toBe(false);expect(f.calls.every(call=>!call.startsWith('send:'))).toBe(true);
 const retry=f.queue.submit('unsaved','submit');await tick();f.gates.shift()!(true);expect(await retry).toBe(true);
 expect(f.calls.at(-1)).toBe('send:unsaved');expect(f.errors).toBeGreaterThan(0);
});
it('rejects queued submission after a Core replacement',async()=>{
 const f=fixture(),saving=f.queue.edit('draft'),sending=f.queue.submit('draft','submit');f.retire();
 f.gates.shift()!(true);expect(await saving).toBe(true);expect(await sending).toBe(false);
 expect(f.calls.every(call=>!call.startsWith('send:'))).toBe(true);
});

it('retries only when a rejected revision still contains a known local value',async()=>{
 const f=fixture(),saving=f.queue.edit('latest');
 f.replace({messages:[],running:false,draft:{status:'draft',revision:2,text:''}});f.gates.shift()!(false);await tick();
 expect(f.calls).toEqual(['edit:latest:1','edit:latest:2']);f.gates.shift()!(true);expect(await saving).toBe(true);
});
it('does not overwrite a different value after a rejected revision',async()=>{
 const f=fixture(),saving=f.queue.edit('local');
 f.replace({messages:[],running:false,draft:{status:'draft',revision:2,text:'foreign'}});f.gates.shift()!(false);
 expect(await saving).toBe(false);expect(f.calls).toEqual(['edit:local:1']);expect(f.errors).toBe(1);
});
it('keeps later edits behind an outstanding admission',async()=>{
 const f=fixture();let release!:(ok:boolean)=>void;
 f.source.submit=text=>{f.calls.push('send:'+text);return new Promise(resolve=>{release=resolve;});};
 const send=f.queue.submit('task','submit');f.gates.shift()!(true);await tick();
 const later=f.queue.edit('next draft');expect(f.calls).toEqual(['edit:task:1','send:task']);
 release(true);await tick();expect(f.calls).toEqual(['edit:task:1','send:task','edit:next draft:2']);
 f.gates.shift()!(true);expect(await send).toBe(true);expect(await later).toBe(true);
});
