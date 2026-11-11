import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';

// A real SDK-owned subprocess with controlled GitHub CLI output, never a
// connection to a user's account. The executable is scoped to the PTY child.
export async function seedCiFixture(cwd){
 const bin=join(cwd,'ci-bin');await mkdir(bin);
 const path=join(bin,'gh');
 await writeFile(path,`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync('ci-calls.jsonl',JSON.stringify(args)+'\\n');
const request=fs.readFileSync('ci-calls.jsonl','utf8').trim().split('\\n').length;
if(fs.existsSync('.ci-slow')){
 fs.writeFileSync('ci-worker.pid',String(process.pid));setInterval(()=>{},1000);
}else{
 const run={databaseId:701,workflowName:'Checks',displayTitle:'CI_FIXTURE_FAILED #'+request,headBranch:'main',status:'completed',conclusion:'failure',url:'https://github.com/fixture/repo/actions/runs/701',createdAt:'2026-11-12T00:00:00Z'};
 if(args[1]==='list')console.log(JSON.stringify([run,{...run,databaseId:702,displayTitle:'CI_FIXTURE_PASSED',conclusion:'success'}]));
 else if(args.includes('--json'))console.log(JSON.stringify({...run,databaseId:Number(args[2]),jobs:[{databaseId:901,name:'Unit tests',status:'completed',conclusion:'failure'}]}));
 else console.log('\\x1b[31m'+(args.includes('--log-failed')?'CI_FAILED_LOG_EVIDENCE':'CI_FULL_LOG_EVIDENCE')+'\\x1b[0m');
}
`);await chmod(path,0o755);return bin;
}
