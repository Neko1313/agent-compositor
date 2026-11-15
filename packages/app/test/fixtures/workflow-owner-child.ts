import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WorkflowEngine} from '../../../../plugins/workflows/engine.js';

const cwd=process.argv[2];if(!cwd)throw Error('Missing fixture directory');
let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
process.stdin.once('data',release);process.stdin.once('end',release);process.stdin.resume();
const engine=new WorkflowEngine({cwd,request:async()=>{await gate;return{output:'completed by owner',tokens:1} as any;}});
try{
 const run=await engine.start({completion:'none',stages:[{id:'a',prompt:'fixture work'}]});
 const file=join(cwd,'.agent-compositor','workflows','runs',run.id+'.json');
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){const saved=JSON.parse(await readFile(file,'utf8'));if(saved.stages[0].status==='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 const saved=JSON.parse(await readFile(file,'utf8'));if(saved.stages[0].status!=='running')throw Error('Worker did not start');
 process.stdout.write(JSON.stringify({ready:true,id:run.id,pid:process.pid})+'\n');
 const result=await engine.wait(run.id);process.stdout.write(JSON.stringify({finished:result?.status})+'\n');
}finally{await engine.close();process.stdin.pause();}
