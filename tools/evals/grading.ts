import {evaluationEnvironment} from './environment.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';

export interface EvalCheck {name:string;ok:boolean;detail?:string}
export interface ProjectExpectations {
  preserve?:string[];
  originalChecks?:string[];
  verification?:string;
  verificationCommands?:string[];
  grader?:string;
}

/** Suite-owned graders execute outside the model prompt, inside its isolated cwd/env. */
export async function gradeProject(input:{
  cwd:string;home:string;temp:string;fixtures:Record<string,string>;
  expect:ProjectExpectations;events:any[];graderTimeoutMs?:number;
}):Promise<EvalCheck[]> {
  const {cwd,home,temp,fixtures,expect:exp,events}=input,checks:EvalCheck[]=[];
  for(const file of exp.preserve??[]){
    if(!Object.hasOwn(fixtures,file))throw Error(`Preserved file has no original fixture: ${file}`);
    const target=join(cwd,file);
    const info=await lstat(target).catch(()=>undefined);
    const bytes=info?.isFile()?await readFile(target).catch(()=>undefined):undefined;
    checks.push({name:`preserved fixture: ${file}`,ok:!!bytes?.equals(Buffer.from(fixtures[file])),
      ...(!bytes?{detail:'Original regular file is missing or replaced'}:{})});
  }
  if(exp.verification){
    const calls=new Map(events.filter(e=>e.kind==='catalog'&&e.event==='tool.call'&&e.input.tool==='exec')
      .map(e=>[e.input.callId,e.input.input?.command]));
    const verified=events.some(e=>{
      if(e.kind!=='catalog'||e.event!=='tool.result'||e.input.tool!=='exec'||!calls.has(e.input.callId))return false;
      const command=calls.get(e.input.callId);
      return (!exp.verificationCommands||exp.verificationCommands.includes(String(command).trim()))&&
        e.input.ok===true&&e.input.output?.exitCode===0&&String(e.input.output?.stdout??'').includes(exp.verification!);
    });
    checks.push({name:'agent executed verification successfully',ok:verified});
  }
  for(const file of exp.originalChecks??[]){
    if(!Object.hasOwn(fixtures,file))throw Error(`Original check has no fixture: ${file}`);
    const reference=join(dirname(join(cwd,file)),`.eval-reference-${randomUUID()}${extname(file)}`);
    try{
      await writeFile(reference,fixtures[file],{flag:'wx',mode:0o600});
      await promisify(execFile)(process.execPath,[reference],{cwd,env:evaluationEnvironment(home,temp),timeout:input.graderTimeoutMs??10000,maxBuffer:64000});
      checks.push({name:`original project checks: ${file}`,ok:true});
    }catch(error){checks.push({name:`original project checks: ${file}`,ok:false,detail:String(error).slice(0,1000)});}
    finally{await rm(reference,{force:true});}
  }
  if(exp.grader){
    const grader=join(temp,'grader.cjs');await writeFile(grader,exp.grader);
    const env=evaluationEnvironment(home,temp);
    try{
      await promisify(execFile)(process.execPath,[grader,cwd],{cwd,env,timeout:input.graderTimeoutMs??10000,maxBuffer:64000});
      checks.push({name:'held-out behavioral grader',ok:true});
    }catch(error){checks.push({name:'held-out behavioral grader',ok:false,detail:String(error).slice(0,1000)});}
  }
  return checks;
}
