import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encodeEditAnchor} from '../../packages/tools/src/edit-ref.js';
import {gradeProject} from './grading.js';
import {runCase} from './runner.js';
import type {ModelProvider} from '../../packages/core/src/provider.js';

const target='pricing.ts', original='n * 2', changed='n * 3';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
let cwd:string;
beforeEach(async()=>{
  cwd=await realpath(await mkdtemp(join(tmpdir(),'navigation-grade-')));
  await writeFile(join(cwd,target),changed);
});
afterEach(async()=>{await rm(cwd,{recursive:true,force:true});});
const anchor=(text=original)=>({path:join(cwd,target),expectedHash:hash(text),range:{start:0,end:text.length},strict:true});
const event=(name:string,id:string,fields:Record<string,unknown>)=>({kind:'catalog',event:name,input:{tool:'edit',callId:id,...fields}});
const call=(input:object,id='e')=>event('tool.call',id,{input});
const checked=(input:object,id='e')=>event('tool.check',id,{input});
const result=(id='e',text=changed,path=join(cwd,target))=>event('tool.result',id,{ok:true,output:{path,match:'exact',replacements:1,hashAfter:hash(text)}});
async function grade(events:ReturnType<typeof event>[]){
  const checks=await gradeProject({cwd,home:cwd,temp:cwd,fixtures:{[target]:original},expect:{guardedEditTarget:target},events});
  return checks[0].ok;
}

it.each(['reference','explicit'] as const)('grades a successful real %s edit through the runner',async form=>{
  const provider:ModelProvider={name:'fixture',async *complete(request){
    const last=request.messages.at(-1);
    if(last?.role==='user')yield {type:'tool_call',id:'read',name:'read',args:{path:target}};
    else if(last?.name==='read'){
      const metadata=JSON.parse(last.content.split('\n')[1]);
      const guard=form==='reference'?{editRef:metadata.editRef}:metadata.edit;
      yield {type:'tool_call',id:'change',name:'edit',args:{...guard,oldText:original,newText:changed}};
    }else{yield {type:'text_delta',text:'Changed.'};yield {type:'finish',reason:'stop'};return;}
    yield {type:'finish',reason:'tool_calls'};
  }};
  const row=await runCase({id:'guarded-edit-'+form,files:{[target]:original},prompt:'Change the multiplier to 3.',expect:{guardedEditTarget:target,file:target,exact:changed}},{model:'scripted',provider,tools:['read','edit']});
  expect(row.ok,row.error??JSON.stringify(row.checks)).toBe(true);
});

it('pairs the effective guarded edit with its exact successful result on the requested file',async()=>{
  const good=anchor(),other={...good,path:join(cwd,'sibling',target)};
  expect(await grade([call(good),checked(good),event('tool.result','e',{ok:false,denied:true})])).toBe(false);
  expect(await grade([call(good),checked(good),result('another')])).toBe(false);
  expect(await grade([call(other),checked(other),result()])).toBe(false);
  expect(await grade([checked({path:good.path,editRef:encodeEditAnchor(other)}),result()])).toBe(false);
  expect(await grade([checked(good),result('e',changed,other.path)])).toBe(false);
  expect(await grade([call(good),checked({path:good.path}),result()])).toBe(false);
  expect(await grade([call(good),result()])).toBe(false);
  expect(await grade([call(good),checked(good),result()].map(e=>({...e,input:{...e.input,operationId:'manual'}})))).toBe(false);
});

it('ties multiple guarded edits to the original fixture and the final target bytes',async()=>{
  const first=anchor(),middle='n * 4',second={path:first.path,editRef:encodeEditAnchor(anchor(middle))};
  const steps=[call(first),checked(first),result('e',middle),call(second,'b'),checked(second,'b'),result('b')];
  expect(await grade(steps)).toBe(true);
  expect(await grade(steps.slice(3))).toBe(false);
  expect(await grade(steps.slice(0,3))).toBe(false);
});
