import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {hello} from '@agent-compositor/protocol';
import {runInkRenderer} from '../../src/run.ts';
const tty=process.argv[2]==='tty',marker='LIVE_FRAME_BEFORE_EXIT';
const stdin=Object.assign(new PassThrough(),{isTTY:true,setRawMode(){},ref(){},unref(){}});
const stdout=Object.assign(new PassThrough(),{isTTY:tty,columns:80,rows:24});
let output='',release;stdout.on('data',chunk=>{output+=chunk;});
const gate=new Promise(resolve=>{release=resolve;});
async function* source(){
 yield hello('core',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']});
 yield{type:'declare',surfaces:[{id:'live',kind:'pane',title:'Live'}]};
 yield{type:'layout',width:80,height:24,frames:[{surface:'live',x:0,y:0,width:80,height:24}]};
 yield{type:'render',surface:'live',mode:'full',flush:true,grid:[Array.from(marker,ch=>({ch}))]};
 await gate;yield{type:'bye',reason:'fixture complete'};
}
const renderer=await runInkRenderer({source:source(),send(){},stdin,stdout,stderr:stdout,hostControlsExit:true,graphics:'off',exit(){}});
let beforeExit;
try{
 if(tty){
  const deadline=Date.now()+1000;
  while(!output.includes(marker)&&Date.now()<deadline)await delay(10);
 }else await delay(100);
 beforeExit=output.includes(marker);
 assert.equal(beforeExit,tty,'TTY must repaint before exit; piped output must remain static');
}finally{
 release();await renderer.waitUntilExit;stdin.destroy();stdout.destroy();
}
assert.ok(output.includes(marker),'Final output must retain the completed frame');
console.log(JSON.stringify({tty,beforeExit,afterExit:true}));
