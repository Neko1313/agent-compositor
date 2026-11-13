import {evaluationEnvironment} from './environment.js';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {lstat,readFile,realpath,writeFile,rm} from 'node:fs/promises';
import {join,dirname,extname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {resolveEditRef} from '../../packages/tools/src/edit-ref.js';

export interface EvalCheck {name:string;ok:boolean;detail?:string}
export interface PermissionPreviewExpectation {tool:string;args:Record<string,unknown>;decision:'allow'|'ask'|'deny'}
/** Correlate actual host results; a final-answer claim or unrelated result is insufficient. */
export function gradePermissionPreviews(events:any[],expected:PermissionPreviewExpectation[]):EvalCheck[] {
  const calls=new Map(events.filter(e=>e.kind==='catalog'&&e.event==='tool.call'&&e.input.tool==='tool_help'&&!e.input.operationId)
    .map(e=>[e.input.callId,e.input.input]));
  return expected.map(want=>({name:`permission preview: ${want.tool} ${JSON.stringify(want.args)} → ${want.decision}`,ok:events.some(e=>{
    if(e.kind!=='catalog'||e.event!=='tool.result'||e.input.tool!=='tool_help'||e.input.operationId||e.input.ok!==true)return false;
    const call=calls.get(e.input.callId) as any,permission=e.input.output?.permission;
    return call?.name===want.tool&&isDeepStrictEqual(call.preview,want.args)&&permission?.decision===want.decision&&
      permission.scope==='rules-and-session-approvals'&&permission.executionAuthorized===false;
  })}));
}
export interface ProjectExpectations {
  guardedEditTarget?:string;
  preserve?:string[];
  originalChecks?:string[];
  verification?:string;
  verificationCommands?:string[];
  grader?:string;
}

const sha256 = (bytes:string|Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Match the effective edit after tool.call hooks and before execution. Ranged native edits
 * report the full file hashes on both sides, including when several edits build the result. */
async function guardedFixtureEdit(cwd:string,file:string,original:string,events:any[]):Promise<boolean> {
  const root=await realpath(cwd), target=resolve(root,file);
  if(await realpath(target).catch(()=>undefined)!==target || !(await lstat(target)).isFile())return false;
  const finalHash=sha256(await readFile(target)), initialHash=sha256(original);
  if(finalHash===initialHash)return false;
  let hash=initialHash;
  const checked=new Map<string,string>();
  for(const event of events){
    if(event.kind!=='catalog')continue;
    const entry=event.input;
    if(entry.tool!=='edit'||entry.operationId||typeof entry.callId!=='string'||!entry.callId)continue;
    if(event.event==='tool.call')checked.delete(entry.callId);
    if(event.event==='tool.check'){
      checked.delete(entry.callId);
      try {
        // Dropping the optional explicit path lets the decoder expose the
        // reference's encoded path for comparison with the checked target.
        const args=entry.input;
        if(typeof args?.path!=='string'||resolve(root,args.path)!==target)continue;
        const {path,range,expectedHash}=resolveEditRef(args.editRef===undefined?args:{...args,path:undefined});
        if(typeof path==='string'&&resolve(root,path)===target&&typeof expectedHash==='string'&&range&&
          Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.end>=range.start)
          checked.set(entry.callId,expectedHash);
      } catch { /* Invalid reference or conflicting guards. */ }
    }
    if(event.event==='tool.result'){
      const before=checked.get(entry.callId);
      checked.delete(entry.callId);
      const result=entry.output;
      if(before===hash&&entry.ok===true&&!entry.denied&&result?.path===target&&result.match==='exact'&&
        Number.isSafeInteger(result.replacements)&&result.replacements>0&&typeof result.hashAfter==='string'&&/^[a-f0-9]{64}$/.test(result.hashAfter))
        hash=result.hashAfter;
    }
  }
  return hash===finalHash;
}

/** Suite-owned graders execute outside the model prompt, inside its isolated cwd/env. */
export async function gradeProject(input:{
  cwd:string;home:string;temp:string;fixtures:Record<string,string>;
  expect:ProjectExpectations;events:any[];graderTimeoutMs?:number;
}):Promise<EvalCheck[]> {
  const {cwd,home,temp,fixtures,expect:exp,events}=input,checks:EvalCheck[]=[];
  if(exp.guardedEditTarget){
    const target=exp.guardedEditTarget;
    if(!Object.hasOwn(fixtures,target))throw Error(`Guarded edit target has no original fixture: ${target}`);
    checks.push({name:'fresh snapshot/range edit used',ok:await guardedFixtureEdit(cwd,target,fixtures[target],events)});
  }
  for(const file of exp.preserve??[]){
    if(!Object.hasOwn(fixtures,file))throw Error(`Preserved file has no original fixture: ${file}`);
    const target=join(cwd,file);
    const info=await lstat(target).catch(()=>undefined);
    const bytes=info?.isFile()?await readFile(target).catch(()=>undefined):undefined;
    checks.push({name:`preserved fixture: ${file}`,ok:!!bytes?.equals(Buffer.from(fixtures[file])),
      ...(!bytes?{detail:'Original regular file is missing or replaced'}:{})});
  }
  if(exp.verification){
    const calls=new Map(events.filter(e=>e.kind==='catalog'&&e.event==='tool.call'&&!e.input.operationId&&e.input.tool==='exec')
      .map(e=>[e.input.callId,e.input.input?.command]));
    const verified=events.some(e=>{
      if(e.kind!=='catalog'||e.event!=='tool.result'||e.input.tool!=='exec'||e.input.operationId||!calls.has(e.input.callId))return false;
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
