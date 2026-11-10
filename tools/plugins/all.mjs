import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),queue=(await readdir('plugins',{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name),results=[];
await mkdir('reports/plugins',{recursive:true});
await Promise.all(Array.from({length:3},async()=>{
 while(queue.length){const name=queue.shift();try{
  const result=await exec(process.execPath,['tools/plugins/check.ts',name,'--test'],{maxBuffer:4000000,timeout:180000});
  await writeFile(`reports/plugins/${name}.log`,result.stdout+result.stderr);results.push({name,ok:true});
 }catch(error){await writeFile(`reports/plugins/${name}.log`,String(error.stdout??'')+String(error.stderr??'')+String(error));results.push({name,ok:false});}}
}));
results.sort((a,b)=>a.name.localeCompare(b.name));await writeFile('reports/plugins/report.json',JSON.stringify({ok:results.every(r=>r.ok),plugins:results},null,2)+'\n');console.log(JSON.stringify(results));
if(results.some(r=>!r.ok))process.exitCode=1;
