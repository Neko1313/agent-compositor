import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Casebook,Fixture} from './fixture.js';
const secret='AKIAIOSFODNN7EXAMPLE';
export function simple(f:Fixture,b:Casebook){
 const name=f.name;
 if(name==='guard-scope'){
  b.add('hook.repeat',async()=>{for(let i=0;i<3;i++){const r=await f.emit('tool.check',{tool:'write',input:{path:'../outside'}});assert.match(JSON.stringify(r.value),/deny/);assert.doesNotMatch(JSON.stringify((await f.emit('tool.check',{tool:'write',input:{path:'inside'}})).value),/deny/);}});
  b.add('hook.failure',async()=>{const bad=await f.emit('tool.check',{tool:'write',input:{path:{invalid:true}}},true);assert.equal(bad.faults.length,1);assert.match(JSON.stringify((await f.emit('tool.check',{tool:'edit',input:{path:'../outside'}})).value),/deny/);await assert.rejects(readFile(join(f.root,'outside')));});
 }
 if(name==='guard-secrets'){
  b.add('hook.repeat',async()=>{for(let i=0;i<3;i++){await f.prompt(secret);assert.equal(f.notices.at(-1).level,'error');assert.match(JSON.stringify((await f.emit('tool.call',{tool:'exec',input:{token:secret}})).value),/deny/);}assert.equal(f.models.length,0);});
  b.add('hook.failure',async()=>{const cyclic:any={};cyclic.self=cyclic;assert.equal((await f.emit('tool.call',{tool:'exec',input:cyclic},true)).faults.length,1);await f.prompt(secret);assert.match(f.notices.at(-1).message,/blocked/);assert.equal(f.models.length,0);});
 }
 const commands:Record<string,string>={'slash-commands':'/help','output-style':'/style terse','btw':'/btw Question','doctor':'/doctor','plan-mode':'/plan','session-ctl':'/compact'};
 if(commands[name]){
  b.add('hook.repeat',async()=>{const before=f.notices.length;for(let i=0;i<3;i++)await f.prompt(commands[name]);assert.equal(f.notices.length-before,3);});
  b.add(['hook.failure','command.failure'],async()=>{
   f.failNotify=true;const failed=await f.prompt(commands[name],true);assert.equal(failed.faults.length,1);f.failNotify=false;const before=f.notices.length;await f.prompt(commands[name]);assert.equal(f.notices.length,before+1);
  });
 }
 if(name==='btw'||name==='doctor')b.add('model-dependency-failure',async()=>{f.failModel=true;await f.prompt(commands[name]);assert.match(f.notices.at(-1).message,/FAIL|failed/);f.failModel=false;await f.prompt(commands[name]);assert.doesNotMatch(f.notices.at(-1).message,/FAIL|failed/);});
 if(name==='output-style')b.add('style-off',async()=>{await f.prompt('/style terse');const first=await f.emit('assistant.text',{turnId:'style',text:'Sure! Result'});assert.match(JSON.stringify(first.value),/Result/);assert.doesNotMatch(JSON.stringify(first.value),/Sure/);await f.prompt('/style off');const second=await f.emit('assistant.text',{turnId:'style',text:'Sure! Result'});assert.ok(second.value===undefined||JSON.stringify(second.value).includes('Sure!'));});
 if(name==='session-ctl')b.add('agent-control-failure',async()=>{f.failAgent=true;assert.match(JSON.stringify((await f.prompt('/clear')).value),/session-ctl: failed/);assert.match(f.notices.at(-1).message,/failed/);f.failAgent=false;const old=f.clears;await f.prompt('/clear');assert.equal(f.clears,old+1);});
 if(name==='memory'){
  b.add(['hook.repeat','mutation.result','state.fresh'],async()=>{await rm(f.file('memory.md'),{force:true});for(let i=0;i<3;i++)await f.prompt('# note '+i);const data=await f.saved('memory.md');for(let i=0;i<3;i++)assert.equal(data.split('- note '+i).length,2);});
  b.add('mutation.invalid',async()=>{const before=await f.saved('memory.md');await f.prompt('#   ');assert.equal(await f.saved('memory.md'),before);});
  b.add('mutation.denied',async()=>{const before=await f.saved('memory.md');f.denyWrite=true;assert.equal((await f.prompt('# forbidden',true)).faults.length,1);f.denyWrite=false;assert.equal(await f.saved('memory.md'),before);});
  b.add(['hook.failure','mutation.recovery'],async()=>{const before=await f.saved('memory.md');f.failWrite=true;assert.equal((await f.prompt('# failed',true)).faults.length,1);assert.equal(await f.saved('memory.md'),before);f.failWrite=false;await f.prompt('# recovered');assert.match(await f.saved('memory.md'),/recovered/);});
  b.add(['state.restart','state.migration'],async()=>{await writeFile(join(f.cwd,'.agent-compositor/memory.md'),'LEGACY_MEMORY');await rm(f.file('memory.md'),{force:true});f.resetHost();const r=await f.prompt('Remember?');assert.match(JSON.stringify(r.value),/LEGACY_MEMORY/);await f.prompt('# new');assert.match(await f.saved('memory.md'),/LEGACY_MEMORY/);});
  b.add('state.invalid',async()=>{await f.seed('memory.md','');f.resetHost();const r=await f.prompt('No notes');assert.doesNotMatch(JSON.stringify(r.value??''),/<memory>/);await f.prompt('# valid');assert.match(await f.saved('memory.md'),/valid/);});
  b.add('state.isolation',async()=>{const other=await new Fixture(name,f.directory).init();try{assert.doesNotMatch(JSON.stringify((await other.prompt('Other project')).value??''),/LEGACY_MEMORY|valid|recovered/);}finally{await other.close();}});
 }
 if(name==='turn-log'){
  b.add(['hook.repeat','mutation.result','state.fresh'],async()=>{await rm(f.file('turn-log.jsonl'),{force:true});for(let i=0;i<3;i++){await f.prompt('entry '+i);await f.emit('turn.complete',{turnId:'turn'+i});}const rows=(await f.saved('turn-log.jsonl')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.prompt),['entry 0','entry 1','entry 2']);});
  b.add('mutation.invalid',async()=>{const before=await f.saved('turn-log.jsonl');assert.equal((await f.prompt(undefined as any,true)).faults.length,1);assert.equal(await f.saved('turn-log.jsonl'),before);});
  b.add('mutation.denied',async()=>{const before=await f.saved('turn-log.jsonl');await f.prompt('denied');f.denyWrite=true;assert.equal((await f.emit('turn.complete',{turnId:'denied'},true)).faults.length,1);f.denyWrite=false;assert.equal(await f.saved('turn-log.jsonl'),before);});
  b.add(['hook.failure','mutation.recovery'],async()=>{await f.prompt('recoverable');f.failWrite=true;assert.equal((await f.emit('turn.complete',{turnId:'retry'},true)).faults.length,1);f.failWrite=false;await f.emit('turn.complete',{turnId:'retry'});assert.equal(JSON.parse((await f.saved('turn-log.jsonl')).trim().split('\n').at(-1)!).prompt,'recoverable');});
  b.add(['state.restart','state.migration'],async()=>{await writeFile(join(f.cwd,'.agent-compositor/turn-log.jsonl'),'{"prompt":"legacy"}\n');await rm(f.file('turn-log.jsonl'),{force:true});f.resetHost();await f.prompt('new');await f.emit('turn.complete',{turnId:'new'});const rows=(await f.saved('turn-log.jsonl')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows[0].prompt,'legacy');assert.equal(rows[1].prompt,'new');});
  b.add('state.invalid',async()=>{await f.seed('turn-log.jsonl','malformed\n');await f.prompt('valid');const r=await f.emit('turn.complete',{turnId:'valid'},true);assert.equal(r.faults.length,0);const contents=await f.saved('turn-log.jsonl');assert.ok(contents.startsWith('malformed\n'));assert.equal(JSON.parse(contents.trim().split('\n').at(-1)!).prompt,'valid');});
  b.add('state.isolation',async()=>{const other=await new Fixture(name,f.directory).init();try{await assert.rejects(other.saved('turn-log.jsonl'));}finally{await other.close();}});
 }
 if(name==='checkpoints'){
  b.add(['hook.repeat','mutation.result','state.fresh'],async()=>{for(let i=0;i<3;i++){await writeFile(join(f.cwd,'target'),'before'+i);await f.emit('tool.call',{tool:'write',input:{path:'target'}});await writeFile(join(f.cwd,'target'),'after');await f.prompt('/rewind');assert.equal(await readFile(join(f.cwd,'target'),'utf8'),'before'+i);}});
  b.add('mutation.invalid',async()=>{const before=await f.saved('checkpoints.json');await f.emit('tool.call',{tool:'write',input:{path:123}});assert.equal(await f.saved('checkpoints.json'),before);});
  b.add('mutation.denied',async()=>{await writeFile(join(f.cwd,'target'),'retained');f.denyWrite=true;assert.equal((await f.emit('tool.call',{tool:'write',input:{path:'target'}},true)).faults.length,1);f.denyWrite=false;assert.equal(await readFile(join(f.cwd,'target'),'utf8'),'retained');});
  b.add(['hook.failure','command.failure','mutation.recovery'],async()=>{await writeFile(join(f.cwd,'target'),'recover');await f.emit('tool.call',{tool:'write',input:{path:'target'}});await writeFile(join(f.cwd,'target'),'edited');f.failWrite=true;assert.equal((await f.prompt('/rewind',true)).faults.length,1);assert.equal(await readFile(join(f.cwd,'target'),'utf8'),'edited');f.failWrite=false;await f.prompt('/rewind');assert.equal(await readFile(join(f.cwd,'target'),'utf8'),'recover');});
  b.add(['state.restart','state.migration'],async()=>{await writeFile(join(f.cwd,'.agent-compositor/checkpoints.json'),JSON.stringify([{ts:1,path:'target',content:'legacy'}]));await rm(f.file('checkpoints.json'),{force:true});f.resetHost();await f.prompt('/rewind');assert.equal(await readFile(join(f.cwd,'target'),'utf8'),'legacy');});
  b.add('state.invalid',async()=>{await f.seed('checkpoints.json','bad json');f.resetHost();await f.prompt('/rewind');assert.match(f.notices.at(-1).message,/empty/);assert.equal(await f.saved('checkpoints.json'),'bad json');});
  b.add('state.isolation',async()=>{const other=await new Fixture(name,f.directory).init();try{await other.prompt('/rewind');assert.match(other.notices.at(-1).message,/empty/);}finally{await other.close();}});
 }
 if(name==='export'){
  b.add(['hook.repeat','mutation.result'],async()=>{await f.prompt('export question');await f.emit('assistant.text',{turnId:'a',text:'export answer'});await f.prompt('/export');const before=await f.saved('session-behavior.md');await f.prompt('/export');assert.equal(await f.saved('session-behavior.md'),before);assert.match(before,/export question/);assert.match(before,/export answer/);});
  b.add('mutation.invalid',async()=>{const before=await f.saved('session-behavior.md');assert.equal((await f.emit('assistant.text',{turnId:'a',text:null},true)).faults.length,1);assert.equal(await f.saved('session-behavior.md'),before);});
  b.add('mutation.denied',async()=>{const before=await f.saved('session-behavior.md');f.denyWrite=true;await f.prompt('/export');f.denyWrite=false;assert.equal(await f.saved('session-behavior.md'),before);assert.match(f.notices.at(-1).message,/failed/);});
  b.add(['hook.failure','command.failure','mutation.recovery'],async()=>{const before=await f.saved('session-behavior.md');f.failWrite=true;await f.prompt('/export');assert.match(f.notices.at(-1).message,/failed/);assert.equal(await f.saved('session-behavior.md'),before);f.failWrite=false;await f.prompt('/export');assert.match(f.notices.at(-1).message,/export:/);});
 }
}
